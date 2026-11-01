use super::model::PlayerSnapshot;

/// Largest increase in playback position accepted between two observations.
///
/// The observer samples the player every couple of seconds, so a larger jump
/// means the user seeked; that time is not counted as watched.
const MAX_SAMPLE_GAP_SECS: f64 = 5.0;

/// Watch event ready to be stored in the history.
#[derive(Debug, Clone, PartialEq)]
pub struct WatchRecord {
    pub video_id: String,
    pub title: String,
    pub channel: String,
    pub duration_secs: Option<f64>,
    pub thumbnail_url: Option<String>,
}

/// Tracks playback time and decides when a video counts as watched.
///
/// A session starts when a video is loaded and ends when the video changes or
/// playback stops. Each session is recorded at most once, as soon as the
/// accumulated playback time reaches the configured minimum.
#[derive(Debug, Default)]
pub struct WatchTracker {
    current: Option<Session>,
}

#[derive(Debug)]
struct Session {
    video_id: String,
    watched_secs: f64,
    last_position: Option<f64>,
    recorded: bool,
}

impl WatchTracker {
    /// Feeds a player snapshot and returns a record when one should be saved.
    pub fn observe(
        &mut self,
        snapshot: &PlayerSnapshot,
        minimum_watch_secs: f64,
    ) -> Option<WatchRecord> {
        let Some(video_id) = snapshot.video_id.clone().filter(|value| !value.is_empty()) else {
            self.current = None;
            return None;
        };

        if !self
            .current
            .as_ref()
            .map(|session| session.video_id == video_id)
            .unwrap_or(false)
        {
            self.current = Some(Session {
                video_id: video_id.clone(),
                watched_secs: 0.0,
                last_position: None,
                recorded: false,
            });
        }

        let session = self.current.as_mut().expect("session was just created");

        if snapshot.is_playing {
            if let Some(position) = snapshot.position_secs {
                if let Some(last) = session.last_position {
                    let delta = position - last;
                    if (0.0..=MAX_SAMPLE_GAP_SECS).contains(&delta) {
                        session.watched_secs += delta;
                    }
                }
                session.last_position = Some(position);
            }
        } else {
            // Paused: keep the anchor at the current position so the pause time
            // is not counted.
            session.last_position = snapshot.position_secs;
        }

        if session.recorded || session.watched_secs < minimum_watch_secs {
            return None;
        }

        session.recorded = true;

        Some(WatchRecord {
            video_id: video_id.clone(),
            title: snapshot
                .title
                .clone()
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| video_id.clone()),
            channel: snapshot.channel.clone().unwrap_or_default(),
            duration_secs: snapshot.duration_secs,
            thumbnail_url: snapshot
                .artwork_url
                .clone()
                .filter(|value| !value.is_empty()),
        })
    }

    /// Forgets the current session, e.g. when history recording is disabled.
    pub fn reset(&mut self) {
        self.current = None;
    }
}
