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

    fn install_single(&self, source_dir: &Path, custom_id: Option<&str>) -> AppResult<ExtensionSummary> {
        let target_root = match self.find_extension_root(source_dir) {
            Some(dir) => dir,
            None => {
                return Err(AppError::Validation(format!(
                    "no manifest.json or ytapp.json found in {}",
                    source_dir.display()
                )));
            }
        };

        let chromium = read_chromium_manifest(&target_root.join("manifest.json"))?;
        let ytapp = read_ytapp_manifest(&target_root.join("ytapp.json"))?;

        if chromium.is_none() && ytapp.is_none() {
            return Err(AppError::Validation(
                "the folder contains neither manifest.json (Chromium) nor ytapp.json".into(),
            ));
        }

        let id = if let Some(cid) = custom_id {
            sanitize_id(cid)
        } else {
            resolve_id(&ytapp, source_dir)
        };
        validate_id(&id)?;

        let target = self.primary_root.join(&id);
        if target.exists() {
            let _ = std::fs::remove_dir_all(&target);
        }

        std::fs::create_dir_all(&self.primary_root)?;
        copy_dir_all(&target_root, &target)?;

        let disabled = BTreeSet::new();
        self.read_extension(&target, &disabled)?
            .ok_or_else(|| AppError::Other("failed to read the installed extension".into()))
    }

    /// Installs extensions from a file (e.g. .zip) or folder (including all subfolders and .zip archives found inside).
    pub fn install(&self, source: &Path) -> AppResult<Vec<ExtensionSummary>> {
        // Direct zip file
        if source.is_file() && source.extension().map_or(false, |ext| ext.eq_ignore_ascii_case("zip")) {
            let temp_dir = std::env::temp_dir().join(format!(
                "yt_ext_{}_{}",
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0),
                source.file_stem().and_then(|s| s.to_str()).unwrap_or("ext")
            ));
            extract_zip(source, &temp_dir)?;
            let stem = source.file_stem().and_then(|s| s.to_str());
            let result = self.install_single(&temp_dir, stem);
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Ok(vec![result?]);
        }

        // Folder that is directly an extension
        if source.is_dir() && (source.join("manifest.json").exists() || source.join("ytapp.json").exists()) {
            return Ok(vec![self.install_single(source, None)?]);
        }

        // Folder that contains multiple extensions and/or zip archives
        if source.is_dir() {
            let mut installed = Vec::new();
            let mut errors = Vec::new();

            if let Ok(entries) = std::fs::read_dir(source) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().map_or(false, |ext| ext.eq_ignore_ascii_case("zip")) {
                        let temp_dir = std::env::temp_dir().join(format!(
                            "yt_ext_{}_{}",
                            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0),
                            path.file_stem().and_then(|s| s.to_str()).unwrap_or("ext")
                        ));
                        if let Ok(()) = extract_zip(&path, &temp_dir) {
                            let stem = path.file_stem().and_then(|s| s.to_str());
                            match self.install_single(&temp_dir, stem) {
                                Ok(summary) => installed.push(summary),
                                Err(err) => errors.push(format!("{}: {err}", path.display())),
                            }
                            let _ = std::fs::remove_dir_all(&temp_dir);
                        }
                    } else if path.is_dir() {
                        if self.find_extension_root(&path).is_some() {
                            match self.install_single(&path, None) {
                                Ok(summary) => installed.push(summary),
                                Err(err) => errors.push(format!("{}: {err}", path.display())),
                            }
                        }
                    }
                }
            }

            if !installed.is_empty() {
                return Ok(installed);
            }

            if !errors.is_empty() {
                return Err(AppError::Validation(errors.join("; ")));
            }

            return Err(AppError::Validation(format!(
                "no manifest.json or ytapp.json found in {} or any of its subfolders/zips",
                source.display()
            )));
        }

        Err(AppError::Validation(format!(
            "invalid extension source path: {}",
            source.display()
        )))
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
            let folder = if path.is_file() {
                path.file_stem().and_then(|name| name.to_str()).unwrap_or("extension")
            } else {
                path.file_name().and_then(|name| name.to_str()).unwrap_or("extension")
            };
            sanitize_id(folder)
        })
}

fn extract_zip(zip_file: &Path, dest_dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dest_dir)?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let status = Command::new("tar")
            .args([
                "-xf",
                zip_file.to_str().unwrap_or_default(),
                "-C",
                dest_dir.to_str().unwrap_or_default(),
            ])
            .creation_flags(0x08000000)
            .status();

        if let Ok(s) = status {
            if s.success() {
                return Ok(());
            }
        }

        let ps_cmd = format!(
            "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
            zip_file.to_string_lossy().replace('\'', "''"),
            dest_dir.to_string_lossy().replace('\'', "''")
        );
        let ps_status = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
            .creation_flags(0x08000000)
            .status();

        if let Ok(s) = ps_status {
            if s.success() {
                return Ok(());
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;
        let status = Command::new("unzip")
            .args([
                "-q",
                "-o",
                zip_file.to_str().unwrap_or_default(),
                "-d",
                dest_dir.to_str().unwrap_or_default(),
            ])
            .status();
        if let Ok(s) = status {
            if s.success() {
                return Ok(());
            }
        }
    }

    Err(AppError::Other(format!(
        "failed to extract zip archive {}",
        zip_file.display()
    )))
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
