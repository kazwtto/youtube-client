use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::Row;
use tauri::State;

use crate::core::error::{AppError, AppResult};
use crate::core::state::AppState;
use crate::history::model::WatchEventInput;

const YOUTUBE_REPOSITORY: &str = "https://github.com/kazwtto/youtube-client";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryImportResult {
    browser_name: String,
    imported: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDataSource {
    id: String,
    name: String,
    is_default: bool,
    has_youtube_history: bool,
}

#[derive(Clone, Copy)]
enum HistoryFormat {
    Chromium,
    Firefox,
}

#[derive(Clone)]
struct BrowserHistorySource {
    id: String,
    name: String,
    path: PathBuf,
    format: HistoryFormat,
    is_default: bool,
}

#[tauri::command]
pub async fn browser_data_sources() -> AppResult<Vec<BrowserDataSource>> {
    let mut pending = tokio::task::JoinSet::new();
    for source in browser_history_sources()? {
        pending.spawn(async move {
            let has_youtube_history = browser_source_has_youtube_history(&source)
                .await
                .unwrap_or(false);
            BrowserDataSource {
                id: source.id,
                name: source.name,
                is_default: source.is_default,
                has_youtube_history,
            }
        });
    }
    let mut sources = Vec::new();
    while let Some(result) = pending.join_next().await {
        if let Ok(source) = result {
            sources.push(source);
        }
    }
    sources.sort_by_key(|source| !source.is_default);
    Ok(sources)
}

#[tauri::command]
pub async fn browser_history_import(
    state: State<'_, AppState>,
    browser_id: String,
) -> AppResult<BrowserHistoryImportResult> {
    let source = browser_history_sources()?
        .into_iter()
        .find(|source| source.id == browser_id)
        .ok_or_else(|| AppError::NotFound("browser history profile was not found".into()))?;

    let events = read_browser_history(&source).await?;
    let imported = state.history.import_browser_history(events).await?;
    Ok(BrowserHistoryImportResult {
        browser_name: source.name,
        imported,
    })
}

#[tauri::command]
pub fn open_repository() -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", YOUTUBE_REPOSITORY])
            .creation_flags(0x08000000)
            .spawn()?;
    }

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(YOUTUBE_REPOSITORY)
        .spawn()?;

    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open")
        .arg(YOUTUBE_REPOSITORY)
        .spawn()?;

    Ok(())
}

async fn read_browser_history(source: &BrowserHistorySource) -> AppResult<Vec<WatchEventInput>> {
    let options = SqliteConnectOptions::new()
        .filename(&source.path)
        .read_only(true)
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(4));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;

    let sql = match source.format {
        HistoryFormat::Chromium => {
            "SELECT url, title, last_visit_time FROM urls WHERE last_visit_time > 0 AND (url LIKE '%youtube.com%' OR url LIKE '%youtu.be%') ORDER BY last_visit_time DESC LIMIT 50000"
        }
        HistoryFormat::Firefox => {
            "SELECT url, title, last_visit_date FROM moz_places WHERE last_visit_date > 0 AND (url LIKE '%youtube.com%' OR url LIKE '%youtu.be%') ORDER BY last_visit_date DESC LIMIT 50000"
        }
    };
    let rows = sqlx::query(sql).fetch_all(&pool).await?;
    pool.close().await;

    let mut seen = std::collections::HashSet::new();
    let mut events = Vec::new();
    for row in rows {
        let url: String = row.try_get(0)?;
        let title: Option<String> = row.try_get(1)?;
        let Some(video_id) = youtube_video_id(&url) else {
            continue;
        };
        if !seen.insert(video_id.clone()) {
            continue;
        }

        let visit_time: i64 = row.try_get(2)?;
        let watched_at = match source.format {
            HistoryFormat::Chromium => visit_time / 1_000 - 11_644_473_600_000,
            HistoryFormat::Firefox => visit_time / 1_000,
        };
        events.push(WatchEventInput {
            title: title
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| video_id.clone()),
            video_id: video_id.clone(),
            channel: String::new(),
            duration_secs: None,
            thumbnail_url: Some(format!("https://i.ytimg.com/vi/{video_id}/mqdefault.jpg")),
            watched_at: Some(watched_at),
            position_secs: None,
            watched_secs: None,
            session_key: None,
        });
    }
    Ok(events)
}

async fn browser_source_has_youtube_history(source: &BrowserHistorySource) -> AppResult<bool> {
    let options = SqliteConnectOptions::new()
        .filename(&source.path)
        .read_only(true)
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(4));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    let sql = match source.format {
        HistoryFormat::Chromium => "SELECT COUNT(*) FROM urls WHERE url LIKE '%youtube.com/watch%' OR url LIKE '%youtube.com/shorts/%' OR url LIKE '%youtube.com/live/%' OR url LIKE '%youtube.com/embed/%' OR url LIKE '%youtu.be/%'",
        HistoryFormat::Firefox => "SELECT COUNT(*) FROM moz_places WHERE url LIKE '%youtube.com/watch%' OR url LIKE '%youtube.com/shorts/%' OR url LIKE '%youtube.com/live/%' OR url LIKE '%youtube.com/embed/%' OR url LIKE '%youtu.be/%'",
    };
    let count = sqlx::query_scalar::<_, i64>(sql).fetch_one(&pool).await?;
    pool.close().await;
    Ok(count > 0)
}

fn youtube_video_id(raw_url: &str) -> Option<String> {
    let (_, remainder) = raw_url.split_once("://")?;
    let (authority, suffix) = remainder.split_once('/').unwrap_or((remainder, ""));
    let host = authority
        .split([':', '?', '#'])
        .next()?
        .trim_start_matches("www.")
        .to_ascii_lowercase();
    let path = suffix.split(['?', '#']).next().unwrap_or("");
    let path_segments: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();

    let candidate = if host == "youtu.be" {
        path_segments.first().copied()
    } else if host == "youtube.com" || host.ends_with(".youtube.com") {
        let query = suffix.split_once('?').map(|(_, query)| query).unwrap_or("");
        let query_id = query.split('&').find_map(|part| part.strip_prefix("v="));
        query_id.or_else(|| match path_segments.as_slice() {
            ["shorts", id, ..] | ["live", id, ..] | ["embed", id, ..] | ["v", id, ..] => Some(*id),
            _ => None,
        })
    } else {
        None
    }?;

    (candidate.len() == 11
        && candidate
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'))
    .then(|| candidate.to_string())
}

#[cfg(windows)]
fn default_browser_id() -> Option<&'static str> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let prog_id = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(
            r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice",
        )
        .ok()?
        .get_value::<String, _>("ProgId")
        .ok()?;
    let normalized = prog_id.to_ascii_lowercase();
    if normalized.contains("firefox") {
        Some("firefox")
    } else if normalized.contains("edge") {
        Some("edge")
    } else if normalized.contains("brave") {
        Some("brave")
    } else if normalized.contains("vivaldi") {
        Some("vivaldi")
    } else if normalized.contains("opera") && normalized.contains("gx") {
        Some("opera-gx")
    } else if normalized.contains("opera") {
        Some("opera")
    } else if normalized.contains("chrome") {
        Some("chrome")
    } else {
        None
    }
}

#[cfg(not(windows))]
fn default_browser_id() -> Option<&'static str> {
    None
}

#[cfg(windows)]
fn browser_history_sources() -> AppResult<Vec<BrowserHistorySource>> {
    let local = env_path("LOCALAPPDATA")?;
    let roaming = env_path("APPDATA")?;
    let default_id = default_browser_id();
    let mut sources = Vec::new();
    let mut add = |mut source: BrowserHistorySource| {
        if source.path.is_file() {
            source.is_default = default_id == Some(source.id.as_str());
            sources.push(source);
        }
    };

    add(chromium_history_source(
        "edge",
        "Edge",
        &local.join("Microsoft/Edge/User Data"),
    ));
    add(chromium_history_source(
        "chrome",
        "Chrome",
        &local.join("Google/Chrome/User Data"),
    ));
    add(chromium_history_source(
        "brave",
        "Brave",
        &local.join("BraveSoftware/Brave-Browser/User Data"),
    ));
    add(chromium_history_source(
        "vivaldi",
        "Vivaldi",
        &local.join("Vivaldi/User Data"),
    ));

    for (id, name, folder) in [
        ("opera", "Opera", "Opera Stable"),
        ("opera-gx", "Opera GX", "Opera GX Stable"),
    ] {
        let profile = roaming.join("Opera Software").join(folder);
        add(BrowserHistorySource {
            id: id.into(),
            name: name.into(),
            path: profile.join("History"),
            format: HistoryFormat::Chromium,
            is_default: false,
        });
    }

    if let Ok(source) = firefox_history_source(&roaming) {
        add(source);
    }
    drop(add);
    sources.sort_by_key(|source| !source.is_default);

    Ok(sources)
}

#[cfg(not(windows))]
fn browser_history_sources() -> AppResult<Vec<BrowserHistorySource>> {
    Ok(Vec::new())
}

fn env_path(name: &str) -> AppResult<PathBuf> {
    std::env::var_os(name)
        .map(PathBuf::from)
        .ok_or_else(|| AppError::Other(format!("missing Windows {name} folder")))
}

fn chromium_history_source(id: &str, name: &str, user_data: &Path) -> BrowserHistorySource {
    let profile_name = std::fs::read(user_data.join("Local State"))
        .ok()
        .and_then(|contents| serde_json::from_slice::<serde_json::Value>(&contents).ok())
        .and_then(|state| {
            state
                .pointer("/profile/last_used")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .filter(|profile| !profile.is_empty())
        .unwrap_or_else(|| "Default".into());

    let preferred = user_data.join(profile_name).join("History");
    let path = if preferred.is_file() {
        preferred
    } else {
        let mut profiles: Vec<PathBuf> = std::fs::read_dir(user_data)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_dir()
                    && path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .map(|name| name == "Default" || name.starts_with("Profile "))
                        .unwrap_or(false)
                    && path.join("History").is_file()
            })
            .collect();
        profiles
            .sort_by_key(|path| path.file_name().and_then(|name| name.to_str()) != Some("Default"));
        profiles
            .into_iter()
            .next()
            .map(|profile| profile.join("History"))
            .unwrap_or(preferred)
    };
    BrowserHistorySource {
        id: id.into(),
        name: name.into(),
        path,
        format: HistoryFormat::Chromium,
        is_default: false,
    }
}

fn firefox_history_source(roaming: &Path) -> AppResult<BrowserHistorySource> {
    let profile_root = roaming.join("Mozilla/Firefox");
    let profiles_ini = std::fs::read_to_string(profile_root.join("profiles.ini"))?;
    let mut profiles = Vec::<(String, bool, bool)>::new();
    let mut section = String::new();
    let mut path = None;
    let mut relative = true;
    let mut is_default = false;

    let save_profile = |profiles: &mut Vec<(String, bool, bool)>,
                        section: &str,
                        path: &mut Option<String>,
                        relative: bool,
                        is_default: bool| {
        if section.starts_with("Profile") {
            if let Some(path) = path.take() {
                profiles.push((path, relative, is_default));
            }
        }
    };
    for line in profiles_ini.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            save_profile(&mut profiles, &section, &mut path, relative, is_default);
            section = line[1..line.len() - 1].to_string();
            relative = true;
            is_default = false;
        } else if let Some((key, value)) = line.split_once('=') {
            match key {
                "Path" => path = Some(value.to_string()),
                "IsRelative" => relative = value != "0",
                "Default" => is_default = value == "1",
                _ => {}
            }
        }
    }
    save_profile(&mut profiles, &section, &mut path, relative, is_default);

    let (path, relative, _) = profiles
        .iter()
        .find(|(_, _, is_default)| *is_default)
        .or_else(|| profiles.first())
        .ok_or_else(|| AppError::Other("Firefox profile was not found".into()))?;
    let profile = if *relative {
        profile_root.join(path)
    } else {
        PathBuf::from(path)
    };
    Ok(BrowserHistorySource {
        id: "firefox".into(),
        name: "Firefox".into(),
        path: profile.join("places.sqlite"),
        format: HistoryFormat::Firefox,
        is_default: false,
    })
}
