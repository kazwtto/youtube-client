use serde::{Serialize, Serializer};

/// Application domain errors.
///
/// Every Tauri command returns `Result<T, AppError>`, so the error is
/// serialized as a human-readable message for the UI.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("invalid value: {0}")]
    Validation(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("permission denied: {0}")]
    Permission(String),

    #[error("state unavailable: {0}")]
    State(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("database error: {0}")]
    Database(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        Self::Other(error.to_string())
    }
}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        Self::Other(message)
    }
}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        Self::Other(message.to_string())
    }
}
