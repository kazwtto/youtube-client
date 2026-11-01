use std::time::{Duration, Instant};

use discord_rich_presence::activity::{Activity, Assets, Button, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};

use crate::core::error::{AppError, AppResult};

use super::model::{DiscordActivity, RpcSettings, RpcStatus};

/// Maintains the Discord connection and applies the current presence.
///
/// The presence is rebuilt on every update; the IPC client is reused as long as
/// the Application ID does not change.
pub struct RpcService {
    status: RpcStatus,
    client: Option<DiscordIpcClient>,
    active_app_id: Option<String>,
    last_update: Option<Instant>,
    min_interval: Duration,
}

impl Default for RpcService {
    fn default() -> Self {
        Self::new()
    }
}

impl RpcService {
    pub fn new() -> Self {
        Self {
            status: RpcStatus::disabled(),
            client: None,
            active_app_id: None,
            last_update: None,
            // Avoids IPC spam; YouTube emits events frequently.
            min_interval: Duration::from_secs(15),
        }
    }

    pub fn status(&self) -> RpcStatus {
        self.status.clone()
    }

    /// Applies the desired presence, respecting settings and the rate limit.
    pub fn update(
        &mut self,
        activity: &DiscordActivity,
        settings: &RpcSettings,
        app_id: &str,
    ) -> AppResult<RpcStatus> {
        if !settings.enabled {
            return self.clear(settings);
        }

        let app_id = app_id.trim();
        if app_id.is_empty() {
            self.status = RpcStatus::not_configured();
            return Ok(self.status.clone());
        }

        if let Some(last) = self.last_update {
            if last.elapsed() < self.min_interval {
                return Ok(self.status.clone());
            }
        }

        self.ensure_connected(app_id)?;

        let client = self
            .client
            .as_mut()
            .ok_or_else(|| AppError::State("Discord client unavailable".into()))?;

        client
            .set_activity(to_payload(activity))
            .map_err(|error| AppError::Other(error.to_string()))?;

        self.last_update = Some(Instant::now());
        self.status = RpcStatus::connected();
        Ok(self.status.clone())
    }

    /// Clears the presence and closes the connection.
    pub fn clear(&mut self, settings: &RpcSettings) -> AppResult<RpcStatus> {
        if let Some(mut client) = self.client.take() {
            let _ = client.clear_activity();
            let _ = client.close();
        }
        self.active_app_id = None;

        self.status = if settings.enabled {
            RpcStatus::idle()
        } else {
            RpcStatus::disabled()
        };

        Ok(self.status.clone())
    }

    fn ensure_connected(&mut self, app_id: &str) -> AppResult<()> {
        let same_client = self.client.is_some() && self.active_app_id.as_deref() == Some(app_id);
        if same_client {
            return Ok(());
        }

        if let Some(mut client) = self.client.take() {
            let _ = client.close();
        }

        self.status = RpcStatus::connecting();

        let mut client = DiscordIpcClient::new(app_id);
        client.connect().map_err(|error| {
            self.status = RpcStatus::error(error.to_string());
            AppError::Other(error.to_string())
        })?;

        self.client = Some(client);
        self.active_app_id = Some(app_id.to_string());
        Ok(())
    }
}

/// Converts the domain presence into the payload accepted by Discord.
fn to_payload(activity: &DiscordActivity) -> Activity<'_> {
    let mut payload = Activity::new()
        .details(activity.details.as_str())
        .state(activity.state.as_str());

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
