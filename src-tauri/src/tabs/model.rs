use serde::{Deserialize, Serialize};

use crate::player::{PlayerSnapshot, WatchTracker};

pub const DEFAULT_HISTORY_SCOPE: &str = "default";
pub const DEFAULT_YOUTUBE_URL: &str = "https://www.youtube.com";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TabState {
    pub id: String,
    pub webview_label: String,
    pub isolated: bool,
    pub title: String,
    pub url: String,
    pub thumbnail_url: Option<String>,
    pub account_name: Option<String>,
    pub account_handle: Option<String>,
    pub avatar_url: Option<String>,
    pub pinned: bool,
    pub muted: bool,
    pub sleeping: bool,
    pub needs_reload: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub is_playing: bool,
    pub last_active_at: i64,
}

impl TabState {
    pub fn history_scope(&self) -> &str {
        if self.isolated {
            &self.id
        } else {
            DEFAULT_HISTORY_SCOPE
        }
    }
}

impl Default for TabState {
    fn default() -> Self {
        Self {
            id: "tab-1".to_string(),
            webview_label: "yt-tab-1".to_string(),
            isolated: false,
            title: "YouTube".to_string(),
            url: DEFAULT_YOUTUBE_URL.to_string(),
            thumbnail_url: None,
            account_name: None,
            account_handle: None,
            avatar_url: None,
            pinned: false,
            muted: false,
            sleeping: false,
            needs_reload: false,
            can_go_back: false,
            can_go_forward: false,
            is_playing: false,
            last_active_at: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TabSessionSnapshot {
    pub tabs: Vec<TabState>,
    pub active_tab_id: String,
}

impl Default for TabSessionSnapshot {
    fn default() -> Self {
        Self {
            tabs: vec![TabState::default()],
            active_tab_id: "tab-1".to_string(),
        }
    }
}

#[derive(Debug, Default)]
pub struct TabMediaState {
    pub tracker: WatchTracker,
    pub last_player: Option<PlayerSnapshot>,
    pub last_updated_ms: i64,
}
