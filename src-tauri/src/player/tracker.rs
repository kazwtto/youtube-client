use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::model::PlayerSnapshot;

/// Largest increase in playback position accepted between two observations.
///
/// The observer samples the player every couple of seconds, so a larger jump
/// means the user seeked; that time is not counted as watched.
const MAX_SAMPLE_GAP_SECS: f64 = 5.0;
const PROGRESS_SAVE_INTERVAL_SECS: f64 = 5.0;
static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

/// Watch event ready to be stored in the history.
#[derive(Debug, Clone, PartialEq)]
pub struct WatchRecord {
    pub session_key: String,
    pub video_id: String,
    pub title: String,
    pub channel: String,
    pub duration_secs: Option<f64>,
    pub thumbnail_url: Option<String>,
    pub watched_secs: f64,
    pub position_secs: f64,
    pub is_new_session: bool,
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
    session_key: String,
    video_id: String,
    title: String,
    channel: String,
    duration_secs: Option<f64>,
    thumbnail_url: Option<String>,
    watched_secs: f64,
    last_position: Option<f64>,
    saved_watched_secs: f64,
    saved_position: Option<f64>,
    recorded: bool,
}

impl Session {
    fn new(video_id: String, snapshot: &PlayerSnapshot) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        Self {
            session_key: format!(
                "{}-{now}-{}",
                std::process::id(),
                NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed)
            ),
            video_id: video_id.clone(),
            title: snapshot
                .title
                .clone()
                .filter(|value| !value.is_empty())
                .unwrap_or(video_id),
            channel: snapshot.channel.clone().unwrap_or_default(),
            duration_secs: snapshot.duration_secs,
            thumbnail_url: snapshot
                .artwork_url
                .clone()
                .filter(|value| !value.is_empty()),
            watched_secs: 0.0,
            last_position: None,
            saved_watched_secs: 0.0,
            saved_position: None,
            recorded: false,
        }
    }

    fn update_metadata(&mut self, snapshot: &PlayerSnapshot) {
        if let Some(title) = snapshot.title.as_ref().filter(|value| !value.is_empty()) {
            self.title.clone_from(title);
        }
        if let Some(channel) = snapshot.channel.as_ref() {
            self.channel.clone_from(channel);
        }
        if snapshot.duration_secs.is_some() {
            self.duration_secs = snapshot.duration_secs;
        }
        if let Some(artwork) = snapshot
            .artwork_url
            .as_ref()
            .filter(|value| !value.is_empty())
        {
            self.thumbnail_url = Some(artwork.clone());
        }
    }

    fn save_progress_anchor(&mut self) {
        self.saved_watched_secs = self.watched_secs;
        self.saved_position = self.last_position;
    }

    fn to_record(&self, is_new_session: bool) -> WatchRecord {
        WatchRecord {
            session_key: self.session_key.clone(),
            video_id: self.video_id.clone(),
            title: self.title.clone(),
            channel: self.channel.clone(),
            duration_secs: self.duration_secs,
            thumbnail_url: self.thumbnail_url.clone(),
            watched_secs: self.watched_secs,
            position_secs: self.last_position.unwrap_or_default(),
            is_new_session,
        }
    }

    fn final_progress(self) -> Option<WatchRecord> {
        (self.recorded
            && (self.watched_secs > self.saved_watched_secs
                || self.last_position != self.saved_position))
            .then(|| self.to_record(false))
    }
}

impl WatchTracker {
    /// Feeds a player snapshot and returns a record when one should be saved.
    pub fn observe(
        &mut self,
        snapshot: &PlayerSnapshot,
        minimum_watch_secs: f64,
    ) -> Option<WatchRecord> {
        let Some(video_id) = snapshot.video_id.clone().filter(|value| !value.is_empty()) else {
            return self.current.take().and_then(Session::final_progress);
        };

        let changed = !self
            .current
            .as_ref()
            .map(|session| session.video_id == video_id)
            .unwrap_or(false);
        if changed {
            let previous = self.current.take().and_then(Session::final_progress);
            self.current = Some(Session::new(video_id, snapshot));
            if previous.is_some() {
                return previous;
            }
        }

        let session = self.current.as_mut().expect("session was just created");
        session.update_metadata(snapshot);

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

        if !session.recorded && session.watched_secs < minimum_watch_secs {
            return None;
        }

        if !session.recorded {
            session.recorded = true;
            session.save_progress_anchor();
            return Some(session.to_record(true));
        }

        let position_changed = session.last_position != session.saved_position;
        if session.watched_secs - session.saved_watched_secs < PROGRESS_SAVE_INTERVAL_SECS
            && (snapshot.is_playing || !position_changed)
        {
            return None;
        }

        session.save_progress_anchor();
        Some(session.to_record(false))
    }

    /// Forgets the current session, e.g. when history recording is disabled.
    pub fn reset(&mut self) {
        self.current = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(video_id: &str, position: f64, playing: bool) -> PlayerSnapshot {
        PlayerSnapshot {
            video_id: Some(video_id.into()),
            title: Some(format!("Video {video_id}")),
            channel: Some("Channel".into()),
            artwork_url: Some(format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")),
            is_playing: playing,
            position_secs: Some(position),
            duration_secs: Some(120.0),
            ..Default::default()
        }
    }

    #[test]
    fn counts_playback_until_the_minimum_is_reached() {
        let mut tracker = WatchTracker::default();

        assert_eq!(tracker.observe(&snapshot("a", 0.0, true), 5.0), None);
        assert_eq!(tracker.observe(&snapshot("a", 2.0, true), 5.0), None);
        assert_eq!(tracker.observe(&snapshot("a", 4.0, true), 5.0), None);

        let record = tracker
            .observe(&snapshot("a", 6.0, true), 5.0)
            .expect("minimum reached");

        assert_eq!(record.video_id, "a");
        assert_eq!(record.title, "Video a");
        assert_eq!(record.channel, "Channel");
        assert_eq!(record.duration_secs, Some(120.0));
        assert_eq!(
            record.thumbnail_url.as_deref(),
            Some("https://i.ytimg.com/vi/a/hqdefault.jpg")
        );
    }

    #[test]
    fn ignores_large_position_jumps_after_seeking() {
        let mut tracker = WatchTracker::default();

        tracker.observe(&snapshot("a", 0.0, true), 5.0);
        tracker.observe(&snapshot("a", 2.0, true), 5.0);
        assert_eq!(tracker.observe(&snapshot("a", 100.0, true), 5.0), None);
        assert_eq!(tracker.observe(&snapshot("a", 102.0, true), 5.0), None);

        let record = tracker
            .observe(&snapshot("a", 105.0, true), 5.0)
            .expect("only sampled playback is counted");

        assert_eq!(record.video_id, "a");
    }

    #[test]
    fn does_not_count_paused_time() {
        let mut tracker = WatchTracker::default();

        tracker.observe(&snapshot("a", 0.0, true), 5.0);
        tracker.observe(&snapshot("a", 2.0, true), 5.0);
        tracker.observe(&snapshot("a", 4.0, false), 5.0);
        tracker.observe(&snapshot("a", 20.0, false), 5.0);
        tracker.observe(&snapshot("a", 20.0, true), 5.0);

        assert_eq!(tracker.observe(&snapshot("a", 22.0, true), 5.0), None);
        assert!(tracker.observe(&snapshot("a", 24.0, true), 5.0).is_some());
    }

    #[test]
    fn records_a_session_only_once() {
        let mut tracker = WatchTracker::default();

        tracker.observe(&snapshot("a", 0.0, true), 5.0);
        tracker.observe(&snapshot("a", 2.0, true), 5.0);
        assert!(tracker.observe(&snapshot("a", 6.0, true), 5.0).is_some());
        assert_eq!(tracker.observe(&snapshot("a", 10.0, true), 5.0), None);
    }

    #[test]
    fn resets_when_the_video_changes() {
        let mut tracker = WatchTracker::default();

        tracker.observe(&snapshot("a", 0.0, true), 5.0);
        tracker.observe(&snapshot("a", 2.0, true), 5.0);
        assert!(tracker.observe(&snapshot("a", 6.0, true), 5.0).is_some());

        tracker.observe(&snapshot("b", 0.0, true), 5.0);
        assert_eq!(tracker.observe(&snapshot("b", 2.0, true), 5.0), None);
        assert!(tracker.observe(&snapshot("b", 5.0, true), 5.0).is_some());
    }

    #[test]
    fn restarts_when_the_player_reports_no_video() {
        let mut tracker = WatchTracker::default();

        tracker.observe(&snapshot("a", 0.0, true), 5.0);
        tracker.observe(&snapshot("a", 4.0, true), 5.0);
        assert_eq!(tracker.observe(&PlayerSnapshot::default(), 5.0), None);
        assert_eq!(tracker.observe(&snapshot("a", 8.0, true), 5.0), None);
        assert!(tracker.observe(&snapshot("a", 13.0, true), 5.0).is_some());
    }
}
