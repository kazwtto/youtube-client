use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::core::error::{AppError, AppResult};

use super::manifest::{
    read_chromium_manifest, read_ytapp_manifest, sanitize_id, validate_id, ChromiumManifest,
    YtappManifest,
};

/// Serializable summary of an installed extension.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub permissions: Vec<String>,
    pub enabled: bool,
    pub has_chromium_manifest: bool,
    pub has_ytapp_manifest: bool,
    pub path: String,
}

/// Manages the app extensions folder: discovery, installation, and removal.
pub struct ExtensionService {
    root: PathBuf,
}

impl ExtensionService {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Lists valid extensions, marking those that are not disabled as enabled.
    pub fn list(&self, disabled: &BTreeSet<String>) -> AppResult<Vec<ExtensionSummary>> {
        let mut summaries = Vec::new();

        if !self.root.exists() {
            return Ok(summaries);
        }

        for entry in std::fs::read_dir(&self.root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            // Corrupted or invalid extensions do not interrupt listing.
            if let Ok(Some(summary)) = self.read_extension(&entry.path(), disabled) {
                summaries.push(summary);
            }
        }

        summaries.sort_by_key(|left| left.name.to_lowercase());
        Ok(summaries)
    }

    /// Installs an extension from a local folder, copying it to the app directory.
    pub fn install(&self, source: &Path) -> AppResult<ExtensionSummary> {
        if !source.is_dir() {
            return Err(AppError::Validation(format!(
                "invalid installation path: {}",
                source.display()
            )));
        }

        let chromium = read_chromium_manifest(&source.join("manifest.json"))?;
        let ytapp = read_ytapp_manifest(&source.join("ytapp.json"))?;

        if chromium.is_none() && ytapp.is_none() {
            return Err(AppError::Validation(
                "the folder contains neither manifest.json (Chromium) nor ytapp.json".into(),
            ));
        }

        let id = resolve_id(&ytapp, source);
        validate_id(&id)?;

        let target = self.root.join(&id);
        if target.exists() {
            return Err(AppError::Validation(format!(
                "extension already installed: {id}"
            )));
        }

        std::fs::create_dir_all(&self.root)?;
        copy_dir_all(source, &target)?;

        let disabled = BTreeSet::new();
        self.read_extension(&target, &disabled)?
            .ok_or_else(|| AppError::Other("failed to read the installed extension".into()))
    }

    /// Removes an extension by identifier.
    pub fn uninstall(&self, id: &str) -> AppResult<()> {
        validate_id(id)?;

        let disabled = BTreeSet::new();
        let target = self
            .list(&disabled)?
            .into_iter()
            .find(|extension| extension.id == id)
            .map(|extension| PathBuf::from(extension.path))
            .ok_or_else(|| AppError::NotFound(format!("extension: {id}")))?;

        std::fs::remove_dir_all(target)?;
        Ok(())
    }

    fn read_extension(
        &self,
        path: &Path,
        disabled: &BTreeSet<String>,
    ) -> AppResult<Option<ExtensionSummary>> {
        let chromium = read_chromium_manifest(&path.join("manifest.json"))?;
        let ytapp = read_ytapp_manifest(&path.join("ytapp.json"))?;

        if chromium.is_none() && ytapp.is_none() {
            return Ok(None);
        }

        let id = resolve_id(&ytapp, path);
        validate_id(&id)?;

        let name = ytapp
            .as_ref()
            .map(|manifest| manifest.name.clone())
            .or_else(|| chromium.as_ref().map(|manifest| manifest.name.clone()))
            .unwrap_or_else(|| id.clone());

        let version = ytapp
            .as_ref()
            .map(|manifest| manifest.version.clone())
            .or_else(|| chromium.as_ref().map(|manifest| manifest.version.clone()))
            .unwrap_or_else(|| "0.0.0".into());

        let description = ytapp
            .as_ref()
            .and_then(|manifest| manifest.description.clone())
            .or_else(|| {
                chromium
                    .as_ref()
                    .and_then(|manifest| manifest.description.clone())
            });

        let permissions = ytapp
            .as_ref()
            .map(|manifest| {
                manifest
                    .permissions
                    .iter()
                    .map(|permission| permission.as_str().to_string())
                    .collect()
            })
            .unwrap_or_default();

        Ok(Some(ExtensionSummary {
            enabled: !disabled.contains(&id),
            has_chromium_manifest: chromium.is_some(),
            has_ytapp_manifest: ytapp.is_some(),
            path: path.to_string_lossy().into_owned(),
            id,
            name,
            version,
            description,
            permissions,
        }))
    }
}

fn resolve_id(ytapp: &Option<YtappManifest>, path: &Path) -> String {
    ytapp
        .as_ref()
        .map(|manifest| manifest.id.clone())
        .unwrap_or_else(|| {
            let folder = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("extension");
            sanitize_id(folder)
        })
}

/// Metadata read independently of the Chromium manifest, used during listing.
#[allow(dead_code)]
fn chromium_metadata(manifest: &ChromiumManifest) -> (&str, &str) {
    (manifest.name.as_str(), manifest.version.as_str())
}

/// Recursive directory copy.
fn copy_dir_all(source: &Path, destination: &Path) -> AppResult<()> {
    std::fs::create_dir_all(destination)?;

    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = destination.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }

    Ok(())
}
