use std::path::Path;

use serde::Deserialize;

use crate::core::error::{AppError, AppResult};

use super::permissions::Permission;

/// Subset of the Chromium manifest sufficient to validate the extension.
#[derive(Debug, Clone, Deserialize)]
pub struct ChromiumManifest {
    pub name: String,
    pub version: String,
    /// Chromium manifests use the snake_case key `manifest_version`.
    #[serde(rename = "manifest_version")]
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
    let mut manifest: ChromiumManifest = serde_json::from_str(&raw).map_err(|error| {
        AppError::Validation(format!(
            "invalid manifest.json ({}): {error}",
            path.display()
        ))
    })?;

    if manifest.name.trim().is_empty() {
        return Err(AppError::Validation("manifest.json has no name".into()));
    }

    // Resolve __MSG_...__ i18n localization if present
    if manifest.name.starts_with("__MSG_") && manifest.name.ends_with("__") {
        let key = &manifest.name[6..manifest.name.len() - 2];
        if let Some(parent) = path.parent() {
            if let Some(resolved) = resolve_chrome_msg(parent, key) {
                manifest.name = resolved;
            } else {
                manifest.name = key.replace('_', " ");
            }
        }
    }

    if let Some(desc) = &manifest.description {
        if desc.starts_with("__MSG_") && desc.ends_with("__") {
            let key = &desc[6..desc.len() - 2];
            if let Some(parent) = path.parent() {
                if let Some(resolved) = resolve_chrome_msg(parent, key) {
                    manifest.description = Some(resolved);
                }
            }
        }
    }

    validate_version(&manifest.version)?;

    if manifest.manifest_version < 2 || manifest.manifest_version > 3 {
        return Err(AppError::Validation(format!(
            "manifest.json must use manifest_version 2 or 3 (got {})",
            manifest.manifest_version
        )));
    }

    Ok(Some(manifest))
}

fn resolve_chrome_msg(extension_dir: &Path, key: &str) -> Option<String> {
    let locales_dir = extension_dir.join("_locales");
    if !locales_dir.exists() {
        return None;
    }

    let candidates = ["pt_BR", "pt", "en", "en_US", "en_GB"];
    for lang in candidates {
        let file = locales_dir.join(lang).join("messages.json");
        if file.exists() {
            if let Ok(raw) = std::fs::read_to_string(&file) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
                    if let Some(msg) = val
                        .get(key)
                        .and_then(|entry| entry.get("message"))
                        .and_then(|m| m.as_str())
                    {
                        if !msg.is_empty() {
                            return Some(msg.to_string());
                        }
                    }
                    if let Some(obj) = val.as_object() {
                        for (k, entry) in obj {
                            if k.eq_ignore_ascii_case(key) {
                                if let Some(msg) = entry.get("message").and_then(|m| m.as_str()) {
                                    if !msg.is_empty() {
                                        return Some(msg.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
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

/// Validates a non-empty extension version.
pub fn validate_version(version: &str) -> AppResult<()> {
    let trimmed = version.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("invalid version: empty".into()));
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ytdesktop-manifest-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn reads_a_chromium_manifest_with_a_snake_case_version() {
        let dir = temp_dir("chromium");
        let path = dir.join("manifest.json");
        std::fs::write(
            &path,
            r#"{"manifest_version":3,"name":"Sample","version":"1.2.3","permissions":["storage"]}"#,
        )
        .expect("write manifest");

        let manifest = read_chromium_manifest(&path)
            .expect("read manifest")
            .expect("manifest present");

        assert_eq!(manifest.manifest_version, 3);
        assert_eq!(manifest.name, "Sample");
        assert_eq!(manifest.version, "1.2.3");
        assert_eq!(manifest.permissions, vec!["storage"]);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_a_manifest_without_manifest_version() {
        let dir = temp_dir("missing-version");
        let path = dir.join("manifest.json");
        std::fs::write(
            &path,
            r#"{"manifestVersion":3,"name":"Sample","version":"1.0"}"#,
        )
        .expect("write manifest");

        assert!(read_chromium_manifest(&path).is_err());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn accepts_supported_version_formats() {
        for version in ["1", "1.2", "1.2.3", "1.2.3.4"] {
            assert!(validate_version(version).is_ok(), "{version}");
        }

        for version in ["", "1.", ".1", "1.2a", "1..2"] {
            assert!(validate_version(version).is_err(), "{version}");
        }
    }

    #[test]
    fn sanitizes_folder_names_into_ids() {
        assert_eq!(sanitize_id("My Extension!"), "my-extension");
        assert_eq!(sanitize_id("   "), "extension");
        assert_eq!(sanitize_id("A_B.C-d"), "a_b.c-d");
    }
}
