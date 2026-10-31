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
            VALUES (?1, ?2, ?3, ?4, NULL, ?5)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                channel = excluded.channel,
                duration_secs = excluded.duration_secs,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&event.video_id)
        .bind(&event.title)
        .bind(&event.channel)
        .bind(event.duration_secs)
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
