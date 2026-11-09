use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use discord_rich_presence::activity::{
    Activity, ActivityType, Assets, Button, StatusDisplayType, Timestamps,
};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use tauri::{AppHandle, Emitter};

use crate::core::error::AppResult;
use crate::core::events;

use super::model::{DiscordActivity, RpcSettings, RpcStatus};

#[derive(Clone)]
struct RpcCommand {
    activity: Option<DiscordActivity>,
    settings: RpcSettings,
    app_id: String,
}

struct SharedState {
    status: RpcStatus,
    pending: Option<RpcCommand>,
    has_update: bool,
    running: bool,
}

/// Maintains the Discord connection in a dedicated background thread so IPC
/// never stalls the Tauri runtime or the UI.
pub struct RpcService {
    shared: Arc<(Mutex<SharedState>, Condvar)>,
    worker: Option<JoinHandle<()>>,
}

impl Default for RpcService {
    fn default() -> Self {
        Self::new(None)
    }
}

impl RpcService {
    pub fn new(app: Option<AppHandle>) -> Self {
        let shared = Arc::new((
            Mutex::new(SharedState {
                status: RpcStatus::disabled(),
                pending: None,
                has_update: false,
                running: true,
            }),
            Condvar::new(),
        ));

        let shared_clone = Arc::clone(&shared);
        let worker = thread::Builder::new()
            .name("discord-rpc".into())
            .spawn(move || {
                worker_loop(shared_clone, app);
            })
            .ok();

        Self { shared, worker }
    }

    pub fn status(&self) -> RpcStatus {
        let (lock, _) = &*self.shared;
        lock.lock()
            .map(|s| s.status.clone())
            .unwrap_or_else(|_| RpcStatus::disabled())
    }

    /// Enqueues the desired presence asynchronously and returns immediately.
    pub fn update(
        &mut self,
        activity: &DiscordActivity,
        settings: &RpcSettings,
        app_id: &str,
    ) -> AppResult<RpcStatus> {
        let (lock, cvar) = &*self.shared;
        let mut state = lock
            .lock()
            .map_err(|_| crate::core::error::AppError::State("RPC state lock poisoned".into()))?;

        state.pending = Some(RpcCommand {
            activity: Some(activity.clone()),
            settings: settings.clone(),
            app_id: app_id.to_string(),
        });
        state.has_update = true;
        cvar.notify_one();

        Ok(state.status.clone())
    }

    /// Clears the presence and stops integration asynchronously.
    pub fn clear(&mut self, settings: &RpcSettings) -> AppResult<RpcStatus> {
        let (lock, cvar) = &*self.shared;
        let mut state = lock
            .lock()
            .map_err(|_| crate::core::error::AppError::State("RPC state lock poisoned".into()))?;

        state.pending = Some(RpcCommand {
            activity: None,
            settings: settings.clone(),
            app_id: String::new(),
        });
        state.has_update = true;
        cvar.notify_one();

        Ok(state.status.clone())
    }
}

impl Drop for RpcService {
    fn drop(&mut self) {
        let (lock, cvar) = &*self.shared;
        if let Ok(mut state) = lock.lock() {
            state.running = false;
            cvar.notify_all();
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn set_status(
    shared: &Arc<(Mutex<SharedState>, Condvar)>,
    app: &Option<AppHandle>,
    new_status: RpcStatus,
) {
    let mut changed = false;
    {
        let (lock, _) = &**shared;
        if let Ok(mut state) = lock.lock() {
            if state.status != new_status {
                state.status = new_status.clone();
                changed = true;
            }
        }
    }

    if changed {
        if let Some(app) = app {
            let _ = app.emit(events::RPC_STATUS, &new_status);
        }
    }
}

fn worker_loop(shared: Arc<(Mutex<SharedState>, Condvar)>, app: Option<AppHandle>) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut active_app_id: Option<String> = None;
    let mut last_sent_activity: Option<DiscordActivity> = None;
    let mut last_activity_attempt: Option<Instant> = None;
    let mut last_connect_attempt: Option<Instant> = None;
    let mut pending_command: Option<RpcCommand> = None;

    let min_interval = Duration::from_secs(3);
    let connect_retry_cooldown = Duration::from_secs(5);

    loop {
        // 1. Wait for update or timeout
        let (lock, cvar) = &*shared;
        let mut state = match lock.lock() {
            Ok(guard) => guard,
            Err(_) => break,
        };

        while state.running && !state.has_update {
            let wait_timeout = if pending_command.is_some() {
                if client.is_none() {
                    if let Some(last_fail) = last_connect_attempt {
                        let elapsed = last_fail.elapsed();
                        if elapsed < connect_retry_cooldown {
                            connect_retry_cooldown - elapsed
                        } else {
                            Duration::from_millis(50)
                        }
                    } else {
                        Duration::from_millis(50)
                    }
                } else if let Some(last) = last_activity_attempt {
                    let elapsed = last.elapsed();
                    if elapsed < min_interval {
                        min_interval - elapsed
                    } else {
                        Duration::from_millis(50)
                    }
                } else {
                    Duration::from_millis(50)
                }
            } else {
                Duration::from_millis(1000)
            };

            let (guard, timeout_result) = match cvar.wait_timeout(state, wait_timeout) {
                Ok(res) => res,
                Err(_) => return,
            };
            state = guard;
            if timeout_result.timed_out() {
                break;
            }
        }

        if !state.running {
            if let Some(mut c) = client.take() {
                let _ = c.clear_activity();
                let _ = c.close();
            }
            break;
        }

        if state.has_update {
            pending_command = state.pending.take();
            state.has_update = false;
        }

        drop(state);

        // 2. Process command if present
        let Some(command) = pending_command.clone() else {
            continue;
        };

        if !command.settings.enabled {
            if let Some(mut c) = client.take() {
                let _ = c.clear_activity();
                let _ = c.close();
            }
            active_app_id = None;
            last_sent_activity = None;
            last_activity_attempt = None;
            pending_command = None;
            set_status(&shared, &app, RpcStatus::disabled());
            continue;
        }

        let app_id = command.app_id.trim();
        if app_id.is_empty() {
            if let Some(mut c) = client.take() {
                let _ = c.clear_activity();
                let _ = c.close();
            }
            active_app_id = None;
            last_sent_activity = None;
            last_activity_attempt = None;
            pending_command = None;
            set_status(&shared, &app, RpcStatus::not_configured());
            continue;
        }

        // If no activity (video paused with idle_when_paused or empty)
        let Some(activity) = command.activity.clone() else {
            let clear_result = client
                .as_mut()
                .map(|c| c.clear_activity().and_then(|_| c.recv().map(|_| ())));
            if let Some(Err(err)) = clear_result {
                if let Some(mut c) = client.take() {
                    let _ = c.close();
                }
                active_app_id = None;
                set_status(&shared, &app, RpcStatus::error(err.to_string()));
                pending_command = None;
                continue;
            }
            last_sent_activity = None;
            pending_command = None;
            set_status(&shared, &app, RpcStatus::idle());
            continue;
        };

        // App ID changed
        if active_app_id.as_deref() != Some(app_id) {
            if let Some(mut c) = client.take() {
                let _ = c.clear_activity();
                let _ = c.close();
            }
            active_app_id = None;
            last_sent_activity = None;
            last_activity_attempt = None;
        }

        // Connect if needed
        if client.is_none() {
            if let Some(last_fail) = last_connect_attempt {
                if last_fail.elapsed() < connect_retry_cooldown {
                    // Retry cooldown active; wait
                    continue;
                }
            }

            set_status(&shared, &app, RpcStatus::connecting());
            last_connect_attempt = Some(Instant::now());

            let mut new_client = DiscordIpcClient::new(app_id);
            match new_client.connect() {
                Ok(_) => {
                    client = Some(new_client);
                    active_app_id = Some(app_id.to_string());
                    set_status(&shared, &app, RpcStatus::connected());
                }
                Err(err) => {
                    client = None;
                    active_app_id = None;
                    set_status(&shared, &app, RpcStatus::error(err.to_string()));
                    continue;
                }
            }
        }

        // Rate limit check
        if let Some(last_attempt) = last_activity_attempt {
            if last_attempt.elapsed() < min_interval {
                // Keep pending_command to be sent after cooldown
                continue;
            }
        }

        // Check if activity identical to last sent
        if last_sent_activity.as_ref() == Some(&activity) {
            pending_command = None;
            continue;
        }

        // Send activity
        let payload = to_payload(&activity);
        last_activity_attempt = Some(Instant::now());
        if let Some(c) = client.as_mut() {
            match c.set_activity(payload) {
                Ok(_) => {
                    // Drain the response frame from Discord IPC pipe
                    let response_ok = match c.recv() {
                        Ok((_op, val)) => {
                            if let Some(evt) = val.get("evt").and_then(|v| v.as_str()) {
                                if evt == "ERROR" {
                                    let msg = val
                                        .get("data")
                                        .and_then(|d| d.get("message"))
                                        .and_then(|m| m.as_str())
                                        .unwrap_or("Discord rejected activity");
                                    set_status(&shared, &app, RpcStatus::error(msg));
                                    false
                                } else {
                                    true
                                }
                            } else {
                                true
                            }
                        }
                        Err(err) => {
                            let _ = c.close();
                            client = None;
                            active_app_id = None;
                            last_sent_activity = None;
                            set_status(&shared, &app, RpcStatus::error(err.to_string()));
                            false
                        }
                    };

                    if response_ok {
                        set_status(&shared, &app, RpcStatus::connected());
                        last_sent_activity = Some(activity);
                        pending_command = None;
                    }
                }
                Err(err) => {
                    let _ = c.close();
                    client = None;
                    active_app_id = None;
                    last_sent_activity = None;
                    set_status(&shared, &app, RpcStatus::error(err.to_string()));
                }
            }
        }
    }
}

/// Converts the domain presence into the payload accepted by Discord.
fn to_payload(activity: &DiscordActivity) -> Activity<'_> {
    let mut payload = Activity::new()
        .activity_type(if activity.is_music {
            ActivityType::Listening
        } else {
            ActivityType::Watching
        })
        .details(activity.details.as_str())
        .state(activity.state.as_str());

    if activity.is_music {
        payload = payload.status_display_type(StatusDisplayType::Details);
    }

    if activity.start_timestamp.is_some() || activity.end_timestamp.is_some() {
        let mut timestamps = Timestamps::new();
        if let Some(start) = activity.start_timestamp {
            timestamps = timestamps.start(start);
        }
        if let Some(end) = activity.end_timestamp {
            timestamps = timestamps.end(end);
        }
        payload = payload.timestamps(timestamps);
    }

    let mut assets = Assets::new();
    let mut has_assets = false;

    if let Some(key) = &activity.large_image_key {
        assets = assets.large_image(key.as_str());
        has_assets = true;
    }
    if let Some(text) = &activity.large_image_text {
        assets = assets.large_text(text.as_str());
        has_assets = true;
    }
    if let Some(key) = &activity.small_image_key {
        assets = assets.small_image(key.as_str());
        has_assets = true;
    }
    if let Some(text) = &activity.small_image_text {
        assets = assets.small_text(text.as_str());
        has_assets = true;
    }
    if has_assets {
        payload = payload.assets(assets);
    }

    if !activity.buttons.is_empty() {
        let buttons = activity
            .buttons
            .iter()
            .take(2)
            .map(|button| Button::new(button.label.as_str(), button.url.as_str()))
            .collect::<Vec<_>>();
        payload = payload.buttons(buttons);
    }

    payload
}
