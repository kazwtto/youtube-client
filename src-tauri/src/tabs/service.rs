use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use crate::core::error::{AppError, AppResult};
use crate::rpc::model::now_millis;

use super::model::{TabSessionSnapshot, TabState, DEFAULT_YOUTUBE_URL};

struct DebouncedWriter {
    pending: Arc<(Mutex<Option<String>>, Condvar)>,
}

impl DebouncedWriter {
    fn new(path: PathBuf) -> Self {
        let pending: Arc<(Mutex<Option<String>>, Condvar)> =
            Arc::new((Mutex::new(None), Condvar::new()));
        let worker_state = Arc::clone(&pending);
        std::thread::Builder::new()
            .name("tabs-session-writer".into())
            .spawn(move || {
                let (lock, cvar) = &*worker_state;
                loop {
                    let mut guard = match lock.lock() {
                        Ok(g) => g,
                        Err(_) => return,
                    };
                    while guard.is_none() {
                        guard = match cvar.wait(guard) {
                            Ok(g) => g,
                            Err(_) => return,
                        };
                    }
                    // Coalesce rapid consecutive saves (page loads, nav updates, tab switches).
                    let _ = cvar.wait_timeout(guard, Duration::from_millis(220));
                    let payload = match lock.lock() {
                        Ok(mut g) => g.take(),
                        Err(_) => return,
                    };
                    if let Some(raw) = payload {
                        let temp = path.with_extension("json.tmp");
                        if std::fs::write(&temp, raw).is_ok() {
                            let _ = std::fs::rename(&temp, &path);
                        }
                    }
                }
            })
            .ok();
        Self { pending }
    }

    fn schedule(&self, raw: String) {
        let (lock, cvar) = &*self.pending;
        if let Ok(mut guard) = lock.lock() {
            *guard = Some(raw);
            cvar.notify_one();
        }
    }
}

pub enum CloseTabOutcome {
    Closed {
        closed: TabState,
        next_active: TabState,
    },
    ResetSingle(TabState),
}

pub struct TabManager {
    path: PathBuf,
    writer: DebouncedWriter,
    session: TabSessionSnapshot,
    closed_history: Vec<TabState>,
    next_tab_seq: u64,
}

impl TabManager {
    pub fn load(path: PathBuf, initial_url: Option<String>) -> AppResult<Self> {
        let mut session = if path.exists() {
            match std::fs::read_to_string(&path) {
                Ok(raw) => serde_json::from_str::<TabSessionSnapshot>(&raw).unwrap_or_default(),
                Err(_) => TabSessionSnapshot::default(),
            }
        } else {
            let mut defaults = TabSessionSnapshot::default();
            if let Some(url) = initial_url {
                if let Some(first) = defaults.tabs.first_mut() {
                    first.url = url;
                }
            }
            defaults
        };

        if session.tabs.is_empty() {
            let mut first = TabState::default();
            first.last_active_at = now_millis();
            session.tabs.push(first);
        }

        for tab in &mut session.tabs {
            tab.sleeping = tab.id != session.active_tab_id;
            tab.is_playing = false;
            tab.needs_reload = false;
        }

        if !session.tabs.iter().any(|t| t.id == session.active_tab_id) {
            session.active_tab_id = session.tabs[0].id.clone();
        }
        if let Some(active) = session
            .tabs
            .iter_mut()
            .find(|t| t.id == session.active_tab_id)
        {
            active.sleeping = false;
            active.last_active_at = now_millis();
        }

        let next_tab_seq = session
            .tabs
            .iter()
            .filter_map(|t| t.id.strip_prefix("tab-").and_then(|n| n.parse::<u64>().ok()))
            .max()
            .unwrap_or(1)
            + 1;

        let writer = DebouncedWriter::new(path.clone());
        let manager = Self {
            path,
            writer,
            session,
            closed_history: Vec::new(),
            next_tab_seq,
        };
        manager.save_now()?;
        Ok(manager)
    }

    pub fn snapshot(&self) -> TabSessionSnapshot {
        self.session.clone()
    }

    pub fn active_tab_id(&self) -> &str {
        &self.session.active_tab_id
    }

    pub fn active_tab(&self) -> Option<&TabState> {
        self.session
            .tabs
            .iter()
            .find(|t| t.id == self.session.active_tab_id)
    }

    pub fn active_tab_mut(&mut self) -> Option<&mut TabState> {
        let id = self.session.active_tab_id.clone();
        self.session.tabs.iter_mut().find(|t| t.id == id)
    }

    pub fn active_history_scope(&self) -> &str {
        self.active_tab()
            .map(TabState::history_scope)
            .unwrap_or(super::model::DEFAULT_HISTORY_SCOPE)
    }

    pub fn tab_by_id(&self, tab_id: &str) -> Option<&TabState> {
        self.session.tabs.iter().find(|t| t.id == tab_id)
    }

    pub fn tab_by_id_mut(&mut self, tab_id: &str) -> Option<&mut TabState> {
        self.session.tabs.iter_mut().find(|t| t.id == tab_id)
    }

    pub fn tab_by_label(&self, label: &str) -> Option<&TabState> {
        self.session.tabs.iter().find(|t| t.webview_label == label)
    }

    pub fn tab_by_label_mut(&mut self, label: &str) -> Option<&mut TabState> {
        self.session
            .tabs
            .iter_mut()
            .find(|t| t.webview_label == label)
    }

    pub fn create_tab(
        &mut self,
        isolated: bool,
        url: Option<String>,
        activate: bool,
    ) -> AppResult<TabState> {
        let seq = self.next_tab_seq;
        self.next_tab_seq += 1;
        let id = format!("tab-{seq}");
        let (account_name, account_handle, avatar_url) = if isolated {
            (None, None, None)
        } else {
            self.session
                .tabs
                .iter()
                .find(|t| !t.isolated && (t.account_name.is_some() || t.avatar_url.is_some()))
                .map(|t| {
                    (
                        t.account_name.clone(),
                        t.account_handle.clone(),
                        t.avatar_url.clone(),
                    )
                })
                .unwrap_or((None, None, None))
        };

        let tab = TabState {
            id: id.clone(),
            webview_label: format!("yt-tab-{seq}"),
            isolated,
            title: "YouTube".to_string(),
            url: url.unwrap_or_else(|| DEFAULT_YOUTUBE_URL.to_string()),
            thumbnail_url: None,
            account_name,
            account_handle,
            avatar_url,
            pinned: false,
            muted: false,
            sleeping: !activate,
            needs_reload: false,
            can_go_back: false,
            can_go_forward: false,
            is_playing: false,
            last_active_at: now_millis(),
        };

        self.session.tabs.push(tab.clone());
        if activate {
            self.session.active_tab_id = id;
        }
        self.save()?;
        Ok(tab)
    }

    pub fn activate_tab(&mut self, tab_id: &str) -> AppResult<TabState> {
        let exists = self.session.tabs.iter().any(|t| t.id == tab_id);
        if !exists {
            return Err(AppError::NotFound(format!("tab {tab_id}")));
        }
        self.session.active_tab_id = tab_id.to_string();
        let now = now_millis();
        if let Some(tab) = self.tab_by_id_mut(tab_id) {
            tab.last_active_at = now;
            tab.sleeping = false;
        }
        let cloned = self
            .tab_by_id(tab_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("tab {tab_id}")))?;
        self.save()?;
        Ok(cloned)
    }

    pub fn close_tab(&mut self, tab_id: &str) -> AppResult<CloseTabOutcome> {
        let index = self
            .session
            .tabs
            .iter()
            .position(|t| t.id == tab_id)
            .ok_or_else(|| AppError::NotFound(format!("tab {tab_id}")))?;

        if self.session.tabs.len() <= 1 {
            let tab = &mut self.session.tabs[0];
            tab.title = "YouTube".to_string();
            tab.url = DEFAULT_YOUTUBE_URL.to_string();
            tab.thumbnail_url = None;
            tab.pinned = false;
            tab.can_go_back = false;
            tab.can_go_forward = false;
            tab.is_playing = false;
            tab.sleeping = false;
            tab.last_active_at = now_millis();
            let cloned = tab.clone();
            self.save()?;
            return Ok(CloseTabOutcome::ResetSingle(cloned));
        }

        let mut closed = self.session.tabs.remove(index);
        closed.is_playing = false;
        self.closed_history.push(closed.clone());
        if self.closed_history.len() > 20 {
            self.closed_history.remove(0);
        }

        if self.session.active_tab_id == tab_id {
            let next_index = index.min(self.session.tabs.len() - 1);
            let next_id = self.session.tabs[next_index].id.clone();
            self.session.active_tab_id = next_id;
        }
        let active_id = self.session.active_tab_id.clone();
        if let Some(active) = self.tab_by_id_mut(&active_id) {
            active.sleeping = false;
            active.last_active_at = now_millis();
        }
        let active_clone = self
            .tab_by_id(&active_id)
            .cloned()
            .ok_or_else(|| AppError::State("active tab missing".into()))?;
        self.save()?;
        Ok(CloseTabOutcome::Closed {
            closed,
            next_active: active_clone,
        })
    }

    pub fn close_other_tabs(&mut self, keep_id: &str) -> AppResult<(Vec<TabState>, TabState)> {
        if self.tab_by_id(keep_id).is_none() {
            return Err(AppError::NotFound(format!("tab {keep_id}")));
        }
        let mut closed = Vec::new();
        let mut remaining = Vec::with_capacity(self.session.tabs.len());
        for mut tab in self.session.tabs.drain(..) {
            if tab.id == keep_id || tab.pinned {
                remaining.push(tab);
            } else {
                tab.is_playing = false;
                self.closed_history.push(tab.clone());
                closed.push(tab);
            }
        }
        while self.closed_history.len() > 20 {
            self.closed_history.remove(0);
        }
        self.session.tabs = remaining;
        self.session.active_tab_id = keep_id.to_string();
        if let Some(active) = self.tab_by_id_mut(keep_id) {
            active.sleeping = false;
            active.last_active_at = now_millis();
        }
        let active_clone = self
            .tab_by_id(keep_id)
            .cloned()
            .ok_or_else(|| AppError::State("active tab missing".into()))?;
        self.save()?;
        Ok((closed, active_clone))
    }

    pub fn reopen_last_closed(&mut self) -> AppResult<Option<TabState>> {
        let Some(mut last) = self.closed_history.pop() else {
            return Ok(None);
        };
        let seq = self.next_tab_seq;
        self.next_tab_seq += 1;
        // Keep the original `id` for isolated tabs so reopening restores the same WebView folder and history.
        if !last.isolated {
            last.id = format!("tab-{seq}");
        }
        last.webview_label = format!("yt-tab-{seq}");
        last.sleeping = false;
        last.is_playing = false;
        last.last_active_at = now_millis();
        self.session.active_tab_id = last.id.clone();
        self.session.tabs.push(last.clone());
        self.save()?;
        Ok(Some(last))
    }

    pub fn reorder_tabs(&mut self, ordered_ids: &[String]) -> AppResult<()> {
        let mut next = Vec::with_capacity(self.session.tabs.len());
        for id in ordered_ids {
            if let Some(pos) = self.session.tabs.iter().position(|t| &t.id == id) {
                next.push(self.session.tabs.remove(pos));
            }
        }
        next.append(&mut self.session.tabs);
        next.sort_by_key(|t| !t.pinned);
        self.session.tabs = next;
        self.save()
    }

    pub fn set_pinned(&mut self, tab_id: &str, pinned: bool) -> AppResult<()> {
        let tab = self
            .tab_by_id_mut(tab_id)
            .ok_or_else(|| AppError::NotFound(format!("tab {tab_id}")))?;
        tab.pinned = pinned;
        self.session.tabs.sort_by_key(|t| !t.pinned);
        self.save()
    }

    pub fn set_muted(&mut self, tab_id: &str, muted: bool) -> AppResult<String> {
        let tab = self
            .tab_by_id_mut(tab_id)
            .ok_or_else(|| AppError::NotFound(format!("tab {tab_id}")))?;
        tab.muted = muted;
        let label = tab.webview_label.clone();
        self.save()?;
        Ok(label)
    }

    pub fn mark_inactive_needs_reload(&mut self) {
        let active_id = self.session.active_tab_id.clone();
        for tab in &mut self.session.tabs {
            if tab.id != active_id && !tab.sleeping {
                tab.needs_reload = true;
            }
        }
    }

    pub fn save_now(&self) -> AppResult<()> {
        let raw = serde_json::to_string_pretty(&self.session)?;
        let temp = self.path.with_extension("json.tmp");
        std::fs::write(&temp, raw)?;
        std::fs::rename(&temp, &self.path)?;
        Ok(())
    }

    pub fn save(&self) -> AppResult<()> {
        let raw = serde_json::to_string_pretty(&self.session)?;
        self.writer.schedule(raw);
        Ok(())
    }
}
