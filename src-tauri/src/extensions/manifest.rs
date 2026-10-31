use std::path::Path;

use serde::Deserialize;

use crate::core::error::{AppError, AppResult};

use super::permissions::Permission;

/// Subset of the Chromium manifest sufficient to validate the extension.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromiumManifest {
    pub name: String,
    pub version: String,
    pub manifest_version: u32,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}

/// App-specific manifest (`ytapp.json`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YtappManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub permissions: Vec<Permission>,
    /// Main content script, relative to the extension folder.
    #[serde(default)]
    pub main: Option<String>,
}

impl YtappManifest {
    pub fn from_path(path: &Path) -> AppResult<Self> {
        let raw = std::fs::read_to_string(path)?;
        let manifest: Self = serde_json::from_str(&raw)?;
        manifest.validate()?;
        Ok(manifest)
    }

    fn validate(&self) -> AppResult<()> {
        validate_id(&self.id)?;
        validate_version(&self.version)?;

        if let Some(main) = &self.main {
            let main_path = Path::new(main);
            if main.contains("..") || main_path.is_absolute() {
                return Err(AppError::Validation(format!("invalid entry path: {main}")));
            }
        }

        Ok(())
    }
}

/// Reads the Chromium manifest, if present.
pub fn read_chromium_manifest(path: &Path) -> AppResult<Option<ChromiumManifest>> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = std::fs::read_to_string(path)?;
    let manifest: ChromiumManifest = serde_json::from_str(&raw).map_err(|error| {
        AppError::Validation(format!(
            "invalid manifest.json ({}): {error}",
            path.display()
        ))
    })?;

    if manifest.name.trim().is_empty() {
        return Err(AppError::Validation("manifest.json has no name".into()));
    }
    validate_version(&manifest.version)?;

    if manifest.manifest_version != 3 {
        return Err(AppError::Validation(
            "manifest.json must use manifest_version 3".into(),
        ));
    }

    Ok(Some(manifest))
}

/// Reads `ytapp.json`, if present.
pub fn read_ytapp_manifest(path: &Path) -> AppResult<Option<YtappManifest>> {
    if !path.exists() {
        return Ok(None);
    }
    YtappManifest::from_path(path).map(Some)
}

/// Validates an extension identifier.
pub fn validate_id(id: &str) -> AppResult<()> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id != "."
        && id != ".."
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        });

    if valid {
        Ok(())
    } else {
        Err(AppError::Validation(format!("invalid extension id: {id}")))
    }
}

/// Validates a version in the format `1`, `1.2`, or `1.2.3`.
pub fn validate_version(version: &str) -> AppResult<()> {
    let parts: Vec<&str> = version.split('.').collect();
    let valid = !parts.is_empty()
        && parts.len() <= 4
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));

    if valid {
        Ok(())
    } else {
        Err(AppError::Validation(format!("invalid version: {version}")))
    }
}

/// Generates a safe id from a folder name.
pub fn sanitize_id(value: &str) -> String {
    let mut sanitized = String::new();

    for character in value.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
            sanitized.push(character.to_ascii_lowercase());
        } else if !sanitized.ends_with('-') {
            sanitized.push('-');
        }
    }

    let sanitized = sanitized.trim_matches('-');
    if sanitized.is_empty() {
        "extension".to_string()
    } else {
        sanitized.chars().take(64).collect()
    }
}
