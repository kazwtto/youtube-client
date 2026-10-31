use serde::{Deserialize, Serialize};

/// Current player state, sent by the observer injected into the YouTube webview.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub video_id: Option<String>,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub channel_id: Option<String>,
    pub artwork_url: Option<String>,
    pub url: Option<String>,
    pub is_playing: bool,
    pub is_livestream: bool,
    pub position_secs: Option<f64>,
    pub duration_secs: Option<f64>,
}

impl PlayerSnapshot {
    /// There is no loaded video when no identifier exists.
    pub fn is_empty(&self) -> bool {
        self.video_id.is_none() && self.title.is_none()
    }
}
