use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::core::error::{AppError, AppResult};
use crate::rpc::model::now_millis;

use super::model::{HistoryEntry, HistoryQuery, WatchEventInput};

/// SQLite history repository. `SqlitePool` is cloneable and thread-safe.
#[derive(Clone)]
pub struct HistoryRepository {
    pool: SqlitePool,
}

impl HistoryRepository {
    /// Opens (creating if necessary) the database and applies migrations.
    pub async fn connect(path: &Path) -> AppResult<Self> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        sqlx::migrate!("./src/history/migrations")
            .run(&pool)
            .await
            .map_err(|error| AppError::Database(error.to_string()))?;

        Ok(Self { pool })
    }

    /// Lists history aggregated by video, with optional title/channel search.
    pub async fn list(&self, query: HistoryQuery) -> AppResult<Vec<HistoryEntry>> {
        let limit = query.limit.clamp(1, 500);
        let offset = query.offset.max(0);
        let search = format!("%{}%", query.search.trim());

        let rows = sqlx::query_as::<_, HistoryEntry>(
            r#"
            SELECT v.id AS id,
                   v.title AS title,
                   v.channel AS channel,
                   v.duration_secs AS duration_secs,
                   v.thumbnail_path AS thumbnail_path,
                   MAX(w.watched_at) AS last_watched_at,
                   COUNT(w.id) AS watch_count
            FROM videos v
            JOIN watch_events w ON w.video_id = v.id
            WHERE (?1 = '%%' OR v.title LIKE ?1 OR v.channel LIKE ?1)
            GROUP BY v.id, v.title, v.channel, v.duration_secs, v.thumbnail_path
            ORDER BY last_watched_at DESC
            LIMIT ?2 OFFSET ?3
            "#,
        )
        .bind(&search)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    /// Records a playback event, updating the video metadata.
    pub async fn record(&self, event: WatchEventInput) -> AppResult<()> {
        let watched_at = event.watched_at.unwrap_or_else(now_millis);

        sqlx::query(
            r#"
            INSERT INTO videos (id, title, channel, duration_secs, thumbnail_path, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                channel = excluded.channel,
                duration_secs = excluded.duration_secs,
                thumbnail_path = COALESCE(excluded.thumbnail_path, videos.thumbnail_path),
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&event.video_id)
        .bind(&event.title)
        .bind(&event.channel)
        .bind(event.duration_secs)
        .bind(&event.thumbnail_url)
        .bind(watched_at)
        .execute(&self.pool)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO watch_events (video_id, watched_at, position_secs, completed)
            VALUES (?1, ?2, ?3, ?4)
            "#,
        )
        .bind(&event.video_id)
        .bind(watched_at)
        .bind(0.0_f64)
        .bind(false)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Removes a video and, by cascade, its events.
    pub async fn delete(&self, id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM videos WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Clears all history.
    pub async fn clear(&self) -> AppResult<()> {
        sqlx::query("DELETE FROM watch_events")
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM videos")
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::model::{HistoryQuery, WatchEventInput};

    fn temp_db(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ytdesktop-history-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir.join("history.db")
    }

    fn event(
        video_id: &str,
        title: &str,
        channel: &str,
        thumbnail: Option<&str>,
        watched_at: i64,
    ) -> WatchEventInput {
        WatchEventInput {
            video_id: video_id.into(),
            title: title.into(),
            channel: channel.into(),
            duration_secs: Some(120.0),
            thumbnail_url: thumbnail.map(str::to_string),
            watched_at: Some(watched_at),
        }
    }

    #[tokio::test]
    async fn records_and_lists_watch_events() {
        let path = temp_db("roundtrip");
        let repository = HistoryRepository::connect(&path).await.expect("connect");

        repository
            .record(event(
                "abc",
                "First",
                "Channel",
                Some("https://img/1.jpg"),
                1_000,
            ))
            .await
            .expect("record");
        repository
            .record(event("abc", "First updated", "Channel", None, 2_000))
            .await
            .expect("record");

        let rows = repository
            .list(HistoryQuery::default())
            .await
            .expect("list");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "abc");
        assert_eq!(rows[0].title, "First updated");
        assert_eq!(rows[0].channel, "Channel");
        assert_eq!(rows[0].duration_secs, Some(120.0));
        assert_eq!(rows[0].thumbnail_path.as_deref(), Some("https://img/1.jpg"));
        assert_eq!(rows[0].last_watched_at, 2_000);
        assert_eq!(rows[0].watch_count, 2);

        drop(repository);
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[tokio::test]
    async fn searches_titles_and_channels() {
        let path = temp_db("search");
        let repository = HistoryRepository::connect(&path).await.expect("connect");

        repository
            .record(event("a", "Rust tutorial", "Code", None, 1_000))
            .await
            .expect("record");
        repository
            .record(event("b", "Gaming", "Rust players", None, 2_000))
            .await
            .expect("record");
        repository
            .record(event("c", "Cooking", "Chef", None, 3_000))
            .await
            .expect("record");

        let rows = repository
            .list(HistoryQuery {
                search: "rust".into(),
                ..Default::default()
            })
            .await
            .expect("list");
        let ids: Vec<&str> = rows.iter().map(|row| row.id.as_str()).collect();
        assert_eq!(ids, vec!["b", "a"]);

        let rows = repository
            .list(HistoryQuery {
                search: "chef".into(),
                ..Default::default()
            })
            .await
            .expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "c");

        drop(repository);
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[tokio::test]
    async fn deletes_and_clears_history() {
        let path = temp_db("delete");
        let repository = HistoryRepository::connect(&path).await.expect("connect");

        repository
            .record(event("a", "One", "Channel", None, 1_000))
            .await
            .expect("record");
        repository
            .record(event("b", "Two", "Channel", None, 2_000))
            .await
            .expect("record");

        repository.delete("a").await.expect("delete");
        let rows = repository
            .list(HistoryQuery::default())
            .await
            .expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "b");

        repository.clear().await.expect("clear");
        assert!(repository
            .list(HistoryQuery::default())
            .await
            .expect("list")
            .is_empty());

        drop(repository);
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }
}
