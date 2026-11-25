ALTER TABLE watch_events ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_watch_events_profile_watched
    ON watch_events(profile_id, watched_at DESC);

CREATE INDEX IF NOT EXISTS idx_watch_events_profile_video
    ON watch_events(profile_id, video_id);
