ALTER TABLE watch_events ADD COLUMN watched_secs REAL NOT NULL DEFAULT 0;
ALTER TABLE watch_events ADD COLUMN session_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_events_session_key
    ON watch_events(session_key)
    WHERE session_key IS NOT NULL;
