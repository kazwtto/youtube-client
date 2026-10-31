use serde::{Deserialize, Serialize};

use crate::player::model::PlayerSnapshot;

/// Discord Rich Presence settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RpcSettings {
    pub enabled: bool,
    /// Discord Application ID used for YouTube.
    pub app_id: String,
    /// Discord Application ID used for YouTube Music.
    pub music_app_id: String,
    /// Shows the "Watch" button with the video URL.
    pub show_video_button: bool,
    /// Shows the channel button.
    pub show_channel_button: bool,
    /// Shows elapsed/total time.
    pub show_timestamps: bool,
    /// Clears the presence when playback is paused.
    pub idle_when_paused: bool,
}

impl Default for RpcSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            app_id: String::new(),
            music_app_id: String::new(),
            show_video_button: true,
            show_channel_button: true,
            show_timestamps: true,
            idle_when_paused: true,
        }
    }
}

/// Current Discord integration status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcStatus {
    pub state: String,
    pub detail: Option<String>,
}

impl RpcStatus {
    pub fn disabled() -> Self {
        Self {
            state: "disabled".into(),
            detail: None,
        }
    }

    pub fn not_configured() -> Self {
        Self {
            state: "notConfigured".into(),
            detail: Some("provide a Discord Application ID".into()),
        }
    }

    pub fn connecting() -> Self {
        Self {
            state: "connecting".into(),
            detail: None,
        }
    }

    pub fn connected() -> Self {
        Self {
            state: "connected".into(),
            detail: None,
        }
    }

    pub fn idle() -> Self {
        Self {
            state: "idle".into(),
            detail: None,
        }
    }

    pub fn error(detail: impl Into<String>) -> Self {
        Self {
            state: "error".into(),
            detail: Some(detail.into()),
        }
    }
}

/// Button shown in the presence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityButton {
    pub label: String,
    pub url: String,
}

/// Desired presence, independent of the transport.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscordActivity {
    pub details: String,
    pub state: String,
    pub start_timestamp: Option<i64>,
    pub end_timestamp: Option<i64>,
    pub large_image_key: Option<String>,
    pub large_image_text: Option<String>,
    pub small_image_key: Option<String>,
    pub small_image_text: Option<String>,
    pub buttons: Vec<ActivityButton>,
}

/// Builds the presence from the player state.
///
/// Returns `None` when there is nothing to display (no video, or paused with
/// `idle_when_paused` enabled), which makes the service clear the presence.
pub fn build_activity(
    snapshot: &PlayerSnapshot,
    settings: &RpcSettings,
    language: &str,
) -> Option<DiscordActivity> {
    if snapshot.is_empty() {
        return None;
    }

    let playing = snapshot.is_playing;
    if !playing && settings.idle_when_paused {
        return None;
    }

    let labels = labels_for(language);

    let title = snapshot
        .title
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "YouTube".into());
    let channel = snapshot
        .channel
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "YouTube".into());

    let (start_timestamp, end_timestamp) = if settings.show_timestamps && !snapshot.is_livestream {
        let position_ms = snapshot.position_secs.unwrap_or(0.0).max(0.0) * 1000.0;
        let start = now_millis() - position_ms as i64;
        let end = snapshot
            .duration_secs
            .filter(|duration| *duration > 0.0)
            .map(|duration| start + (duration * 1000.0) as i64);
        (Some(start), end)
    } else if settings.show_timestamps && snapshot.is_livestream {
        (Some(now_millis()), None)
    } else {
        (None, None)
    };

    let large_image_key = snapshot
        .artwork_url
        .clone()
        .filter(|value| !value.is_empty());
    let large_image_text = Some(title.clone());

    let small_image_key = Some(if playing { "play" } else { "pause" }.to_string());
    let small_image_text = Some(
        if playing {
            labels.playing
        } else {
            labels.paused
        }
        .to_string(),
    );

    let mut buttons = Vec::new();
    if settings.show_video_button {
        if let Some(url) = snapshot.url.clone().filter(|value| !value.is_empty()) {
            buttons.push(ActivityButton {
                label: truncate(labels.watch, 32),
                url,
            });
        }
    }
    if settings.show_channel_button {
        if let Some(channel_id) = snapshot
            .channel_id
            .clone()
            .filter(|value| !value.is_empty())
        {
            buttons.push(ActivityButton {
                label: truncate(labels.channel, 32),
                url: format!("https://www.youtube.com/channel/{channel_id}"),
            });
        }
    }
    buttons.truncate(2);

    Some(DiscordActivity {
        details: title,
        state: format!("{} {channel}", labels.by),
        start_timestamp,
        end_timestamp,
        large_image_key,
        large_image_text,
        small_image_key,
        small_image_text,
        buttons,
    })
}

pub fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

struct RpcLabels {
    playing: &'static str,
    paused: &'static str,
    watch: &'static str,
    channel: &'static str,
    by: &'static str,
}

fn labels_for(language: &str) -> RpcLabels {
    if language.to_ascii_lowercase().starts_with("pt") {
        RpcLabels {
            playing: "Reproduzindo",
            paused: "Pausado",
            watch: "Assistir no YouTube",
            channel: "Abrir canal",
            by: "por",
        }
    } else {
        RpcLabels {
            playing: "Playing",
            paused: "Paused",
            watch: "Watch on YouTube",
            channel: "Open channel",
            by: "by",
        }
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}
