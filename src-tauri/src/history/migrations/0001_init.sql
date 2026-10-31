-- Base schema for playback history.

CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT '',
    duration_secs REAL,
    thumbnail_path TEXT,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    watched_at INTEGER NOT NULL,
    position_secs REAL NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_watch_events_watched_at ON watch_events(watched_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_events_video_id ON watch_events(video_id);

-- Full-text search (FTS5) synchronized by triggers.
CREATE VIRTUAL TABLE IF NOT EXISTS videos_fts USING fts5(
    title,
    channel,
    content='videos',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS videos_ai AFTER INSERT ON videos BEGIN
    INSERT INTO videos_fts(rowid, title, channel) VALUES (new.rowid, new.title, new.channel);
END;

CREATE TRIGGER IF NOT EXISTS videos_ad AFTER DELETE ON videos BEGIN
    INSERT INTO videos_fts(videos_fts, rowid, title, channel)
    VALUES ('delete', old.rowid, old.title, old.channel);
END;

CREATE TRIGGER IF NOT EXISTS videos_au AFTER UPDATE ON videos BEGIN
    INSERT INTO videos_fts(videos_fts, rowid, title, channel)
    VALUES ('delete', old.rowid, old.title, old.channel);
    INSERT INTO videos_fts(rowid, title, channel)
    VALUES (new.rowid, new.title, new.channel);
END;
