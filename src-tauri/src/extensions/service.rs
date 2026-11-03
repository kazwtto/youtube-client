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
    primary_root: PathBuf,
    extra_roots: Vec<PathBuf>,
}

fn extract_zip(zip_path: &Path, dest_dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dest_dir)?;

    let status = std::process::Command::new("tar")
        .arg("-xf")
        .arg(zip_path)
        .arg("-C")
        .arg(dest_dir)
        .status();

    if let Ok(s) = status {
        if s.success() {
            return Ok(());
        }
    }

    let ps_cmd = format!(
        "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
        zip_path.display(),
        dest_dir.display()
    );
    let ps_status = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
        .status();

    if let Ok(s) = ps_status {
        if s.success() {
            return Ok(());
        }
    }

    Err(AppError::Validation(format!(
        "failed to extract zip file: {}",
        zip_path.display()
    )))
}

impl ExtensionService {
    pub fn new(primary_root: PathBuf) -> Self {
        let mut extra_roots = Vec::new();

        if let Ok(cwd) = std::env::current_dir() {
            let cwd_ext = cwd.join("extensions");
            if cwd_ext != primary_root && cwd_ext.exists() {
                extra_roots.push(cwd_ext);
            }
        }

        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                let exe_ext = parent.join("extensions");
                if exe_ext != primary_root && !extra_roots.contains(&exe_ext) && exe_ext.exists() {
                    extra_roots.push(exe_ext);
                }
            }
        }

        Self {
            primary_root,
            extra_roots,
        }
    }

    pub fn root(&self) -> &Path {
        &self.primary_root
    }

    /// Lists valid extensions, marking those that are not disabled as enabled.
    pub fn list(&self, disabled: &BTreeSet<String>) -> AppResult<Vec<ExtensionSummary>> {
        let mut summaries = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();

        let mut all_roots = vec![&self.primary_root];
        for r in &self.extra_roots {
            all_roots.push(r);
        }

        let runtime_cwd = std::env::current_dir().ok().map(|d| d.join("extensions"));
        if let Some(ref cwd_ext) = runtime_cwd {
            if cwd_ext.exists() && !all_roots.iter().any(|r| **r == *cwd_ext) {
                all_roots.push(cwd_ext);
            }
        }

        for root in all_roots {
            if !root.exists() {
                continue;
            }

            let entries = match std::fs::read_dir(root) {
                Ok(e) => e,
                Err(error) => {
                    eprintln!("extensions: failed to read dir {}: {error}", root.display());
                    continue;
                }
            };

            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                    if ext.eq_ignore_ascii_case("zip") || ext.eq_ignore_ascii_case("crx") {
                        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("ext");
                        let dest = root.join(stem);
                        if !dest.exists() {
                            let _ = extract_zip(&path, &dest);
                        }
                    }
                }

                if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                    continue;
                }

                match self.read_extension(&entry.path(), disabled) {
                    Ok(Some(summary)) => {
                        if seen_ids.insert(summary.id.clone()) {
                            summaries.push(summary);
                        }
                    }
                    Ok(None) => {}
                    Err(error) => {
                        eprintln!(
                            "extensions: could not parse extension at {}: {error}",
                            entry.path().display()
                        );
                    }
                }
            }
        }

        summaries.sort_by_key(|left| left.name.to_lowercase());
        Ok(summaries)
    }

    /// Installs an extension from a local folder or zip file, copying it to the app directory.
    pub fn install(&self, source: &Path) -> AppResult<ExtensionSummary> {
        let all = self.install_all(source)?;
        all.into_iter()
            .next()
            .ok_or_else(|| AppError::Validation("no extension found".into()))
    }

    /// Installs all extensions found at a path (which can be a single zip/crx file,
    /// an unpacked extension directory, or a folder containing multiple zips/extensions).
    pub fn install_all(&self, source: &Path) -> AppResult<Vec<ExtensionSummary>> {
        let mut results = Vec::new();

        if source.is_file() {
            let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext.eq_ignore_ascii_case("zip") || ext.eq_ignore_ascii_case("crx") {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis();
                let temp = std::env::temp_dir().join(format!("yt_ext_{now}"));
                extract_zip(source, &temp)?;
                if let Some(root_dir) = self.find_extension_root(&temp) {
                    let fallback_id = source.file_stem().and_then(|s| s.to_str()).unwrap_or("ext");
                    let summary = self.install_single(&root_dir, fallback_id)?;
                    results.push(summary);
                }
                let _ = std::fs::remove_dir_all(&temp);
            }
        } else if source.is_dir() {
            // First, scan for any zip/crx archives in this folder
            if let Ok(entries) = std::fs::read_dir(source) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                        if ext.eq_ignore_ascii_case("zip") || ext.eq_ignore_ascii_case("crx") {
                            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("ext");
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis();
                            let temp = std::env::temp_dir().join(format!("yt_ext_{stem}_{now}"));
                            if extract_zip(&path, &temp).is_ok() {
                                if let Some(root_dir) = self.find_extension_root(&temp) {
                                    if let Ok(summary) = self.install_single(&root_dir, stem) {
                                        results.push(summary);
                                    }
                                }
                                let _ = std::fs::remove_dir_all(&temp);
                            }
                        }
                    } else if path.is_dir() {
                        if let Some(root_dir) = self.find_extension_root(&path) {
                            let folder_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("ext");
                            if let Ok(summary) = self.install_single(&root_dir, folder_name) {
                                results.push(summary);
                            }
                        }
                    }
                }
            }

            // If no child archives or child folders were extensions, check if source itself is an extension
            if results.is_empty() {
                if let Some(target_root) = self.find_extension_root(source) {
                    let folder_name = source.file_name().and_then(|s| s.to_str()).unwrap_or("ext");
                    let summary = self.install_single(&target_root, folder_name)?;
                    results.push(summary);
                }
            }
        }

        if results.is_empty() {
            return Err(AppError::Validation(format!(
                "no manifest.json or ytapp.json found in {}",
                source.display()
            )));
        }

        Ok(results)
    }

    fn install_single(&self, target_root: &Path, fallback_name: &str) -> AppResult<ExtensionSummary> {
        let chromium = read_chromium_manifest(&target_root.join("manifest.json"))?;
        let ytapp = read_ytapp_manifest(&target_root.join("ytapp.json"))?;

        if chromium.is_none() && ytapp.is_none() {
            return Err(AppError::Validation(
                "the folder contains neither manifest.json (Chromium) nor ytapp.json".into(),
            ));
        }

        let id = resolve_id(&ytapp, Path::new(fallback_name));
        validate_id(&id)?;

        let target = self.primary_root.join(&id);
        if target.exists() {
            let _ = std::fs::remove_dir_all(&target);
        }

        std::fs::create_dir_all(&self.primary_root)?;
        copy_dir_all(target_root, &target)?;

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
        entry_path: &Path,
        disabled: &BTreeSet<String>,
    ) -> AppResult<Option<ExtensionSummary>> {
        let target_dir = match self.find_extension_root(entry_path) {
            Some(dir) => dir,
            None => return Ok(None),
        };

        let chromium = read_chromium_manifest(&target_dir.join("manifest.json"))?;
        let ytapp = read_ytapp_manifest(&target_dir.join("ytapp.json"))?;

        if chromium.is_none() && ytapp.is_none() {
            return Ok(None);
        }

        let id = resolve_id(&ytapp, entry_path);
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
            .or_else(|| {
                chromium.as_ref().map(|manifest| manifest.permissions.clone())
            })
            .unwrap_or_default();

        Ok(Some(ExtensionSummary {
            enabled: !disabled.contains(&id),
            has_chromium_manifest: chromium.is_some(),
            has_ytapp_manifest: ytapp.is_some(),
            path: target_dir.to_string_lossy().into_owned(),
            id,
            name,
            version,
            description,
            permissions,
        }))
    }

    fn find_extension_root(&self, path: &Path) -> Option<PathBuf> {
        if path.join("manifest.json").exists() || path.join("ytapp.json").exists() {
            return Some(path.to_path_buf());
        }

        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_dir() {
                        let sub = entry.path();
                        if sub.join("manifest.json").exists() || sub.join("ytapp.json").exists() {
                            return Some(sub);
                        }
                    }
                }
            }
        }

        None
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
