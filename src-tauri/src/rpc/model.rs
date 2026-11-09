use serde::{Deserialize, Serialize};

use crate::player::model::PlayerSnapshot;

/// Discord applications used by the YouTubeDiscordPresence integration.
/// Keeping both identifiers fixed also keeps their registered assets available.
pub const DEFAULT_APP_ID: &str = "847682519214456862";
pub const DEFAULT_MUSIC_APP_ID: &str = "1064295774592180254";

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
            app_id: DEFAULT_APP_ID.to_string(),
            music_app_id: DEFAULT_MUSIC_APP_ID.to_string(),
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
    pub is_music: bool,
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

    let mut title = snapshot
        .title
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "YouTube".into());
    if title.chars().count() < 2 {
        title.push(' ');
    }
    let details = truncate(&title, 128);

    let channel = snapshot
        .channel
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "YouTube".into());
    let mut state_str = format!("{} {channel}", labels.by);
    if state_str.chars().count() < 2 {
        state_str = "YouTube".to_string();
    }
    let state = truncate(&state_str, 128);

    // Discord Rich Presence timestamps are Unix epoch milliseconds.
    let (start_timestamp, end_timestamp) = if settings.show_timestamps && !snapshot.is_livestream {
        let position_ms = seconds_to_millis(snapshot.position_secs.unwrap_or(0.0));
        let start = now_millis().saturating_sub(position_ms);
        let end = snapshot
            .duration_secs
            .filter(|duration| duration.is_finite() && *duration > 0.0)
            .map(|duration| start.saturating_add(seconds_to_millis(duration)));
        (Some(start), end)
    } else if settings.show_timestamps && snapshot.is_livestream {
        (Some(now_millis()), None)
    } else {
        (None, None)
    };

    let fallback_image = if snapshot.is_music() {
        "youtube-music"
    } else if snapshot.is_livestream {
        "youtubelive1"
    } else {
        "youtube3"
    };
    let large_image_key = Some(
        snapshot
            .artwork_url
            .clone()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| fallback_image.to_string()),
    );
    let large_image_text = Some(details.clone());

    // Avoid showing a playing badge when the user keeps a paused activity.
    let (small_image_key, small_image_text) = if playing {
        (
            Some("playing-icon-6".to_string()),
            Some("YouTubeDiscordPresence on GitHub".to_string()),
        )
    } else {
        (None, None)
    };

    let mut buttons = Vec::new();
    if settings.show_video_button {
        if let Some(url) = snapshot.url.clone().filter(|value| !value.is_empty()) {
            if url.starts_with("http://") || url.starts_with("https://") {
                buttons.push(ActivityButton {
                    label: truncate(
                        if snapshot.is_music() {
                            labels.listen
                        } else if snapshot.is_livestream {
                            labels.watch_live
                        } else {
                            labels.watch
                        },
                        32,
                    ),
                    url,
                });
            }
        }
    }
    if settings.show_channel_button {
        if let Some(channel_url) = snapshot
            .channel_url
            .clone()
            .filter(|value| !value.is_empty())
        {
            if channel_url.starts_with("http://") || channel_url.starts_with("https://") {
                buttons.push(ActivityButton {
                    label: truncate(labels.channel, 32),
                    url: channel_url,
                });
            }
        }
    }
    buttons.truncate(2);

    Some(DiscordActivity {
        details,
        state,
        is_music: snapshot.is_music(),
        start_timestamp,
        end_timestamp,
        large_image_key,
        large_image_text,
        small_image_key,
        small_image_text,
        buttons,
    })
}

/// Selects the Discord Application ID for the current source, preferring the
/// dedicated YouTube Music application when one is configured.
pub fn app_id_for(settings: &RpcSettings, is_music: bool) -> &str {
    if is_music && !settings.music_app_id.trim().is_empty() {
        &settings.music_app_id
    } else {
        &settings.app_id
    }
}

pub fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn seconds_to_millis(seconds: f64) -> i64 {
    if seconds.is_finite() && seconds > 0.0 {
        (seconds * 1000.0) as i64
    } else {
        0
    }
}

struct RpcLabels {
    watch: &'static str,
    watch_live: &'static str,
    listen: &'static str,
    channel: &'static str,
    by: &'static str,
}

fn labels_for(language: &str) -> RpcLabels {
    if language.to_ascii_lowercase().starts_with("pt") {
        RpcLabels {
            watch: "Assistir no YouTube",
            watch_live: "Assistir à transmissão",
            listen: "Ouvir junto",
            channel: "Abrir canal",
            by: "por",
        }
    } else {
        RpcLabels {
            watch: "Watch on YouTube",
            watch_live: "Watch livestream",
            listen: "Listen Along",
            channel: "Open channel",
            by: "by",
        }
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn playing_snapshot() -> PlayerSnapshot {
        PlayerSnapshot {
            video_id: Some("abc".into()),
            title: Some("A video".into()),
            channel: Some("A channel".into()),
            channel_url: Some("https://www.youtube.com/@channel".into()),
            artwork_url: Some("https://i.ytimg.com/vi/abc/hqdefault.jpg".into()),
            url: Some("https://www.youtube.com/watch?v=abc".into()),
            is_playing: true,
            position_secs: Some(30.0),
            duration_secs: Some(90.0),
            ..Default::default()
        }
    }

    fn enabled_settings() -> RpcSettings {
        RpcSettings {
            enabled: true,
            app_id: "123".into(),
            music_app_id: "456".into(),
            ..Default::default()
        }
    }

    #[test]
    fn selects_the_music_application_when_configured() {
        let mut settings = enabled_settings();

        assert_eq!(app_id_for(&settings, true), "456");
        assert_eq!(app_id_for(&settings, false), "123");

        settings.music_app_id = "   ".into();
        assert_eq!(app_id_for(&settings, true), "123");
    }

    #[test]
    fn builds_an_activity_with_timestamps_and_buttons() {
        let activity =
            build_activity(&playing_snapshot(), &enabled_settings(), "en").expect("activity");

        assert_eq!(activity.details, "A video");
        assert_eq!(activity.state, "by A channel");
        assert!(!activity.is_music);
        assert_eq!(activity.small_image_key.as_deref(), Some("playing-icon-6"));
        assert_eq!(activity.large_image_text.as_deref(), Some("A video"));
        assert_eq!(activity.buttons.len(), 2);
        assert_eq!(
            activity.buttons[0].url,
            "https://www.youtube.com/watch?v=abc"
        );
        assert_eq!(activity.buttons[1].url, "https://www.youtube.com/@channel");

        let start = activity.start_timestamp.expect("start");
        let end = activity.end_timestamp.expect("end");
        assert_eq!(end - start, 90_000);
        assert!((now_millis() - 30_000 - start).abs() < 5_000);
    }

    #[test]
    fn keeps_only_the_start_for_livestreams() {
        let mut snapshot = playing_snapshot();
        snapshot.is_livestream = true;
        snapshot.duration_secs = Some(f64::INFINITY);

        let activity = build_activity(&snapshot, &enabled_settings(), "en").expect("activity");

        assert!(activity.start_timestamp.is_some());
        assert!(activity.end_timestamp.is_none());
    }

    #[test]
    fn clears_the_activity_without_a_video() {
        assert!(build_activity(&PlayerSnapshot::default(), &enabled_settings(), "en").is_none());
    }

    #[test]
    fn clears_the_activity_when_paused_and_idle_is_enabled() {
        let mut snapshot = playing_snapshot();
        snapshot.is_playing = false;

        assert!(build_activity(&snapshot, &enabled_settings(), "en").is_none());
    }

    #[test]
    fn keeps_the_activity_when_paused_and_idle_is_disabled() {
        let mut snapshot = playing_snapshot();
        snapshot.is_playing = false;

        let mut settings = enabled_settings();
        settings.idle_when_paused = false;

        let activity = build_activity(&snapshot, &settings, "en").expect("activity");
        assert_eq!(activity.details, "A video");
    }

    #[test]
    fn respects_the_button_settings() {
        let mut settings = enabled_settings();
        settings.show_video_button = false;
        settings.show_channel_button = false;

        let activity = build_activity(&playing_snapshot(), &settings, "en").expect("activity");

        assert!(activity.buttons.is_empty());
    }

    #[test]
    fn omits_timestamps_when_disabled() {
        let mut settings = enabled_settings();
        settings.show_timestamps = false;

        let activity = build_activity(&playing_snapshot(), &settings, "en").expect("activity");

        assert!(activity.start_timestamp.is_none());
        assert!(activity.end_timestamp.is_none());
    }

    #[test]
    fn uses_portuguese_labels() {
        let activity =
            build_activity(&playing_snapshot(), &enabled_settings(), "pt-BR").expect("activity");

        assert_eq!(activity.state, "por A channel");
        assert_eq!(activity.buttons[0].label, "Assistir no YouTube");
        assert_eq!(activity.buttons[1].label, "Abrir canal");
    }
}
