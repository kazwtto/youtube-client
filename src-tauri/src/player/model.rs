use serde::{Deserialize, Serialize};

/// Current player state, sent by the observer injected into the YouTube webview.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub video_id: Option<String>,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub channel_url: Option<String>,
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

    /// Whether the video comes from YouTube Music, which uses a dedicated
    /// Discord application.
    pub fn is_music(&self) -> bool {
        self.url
            .as_deref()
            .map(|url| url.contains("music.youtube.com"))
            .unwrap_or(false)
    }
}
