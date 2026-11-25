use std::cmp::Ordering;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::core::error::{AppError, AppResult};
use crate::core::state::AppState;

pub const GITHUB_RELEASES_API: &str =
    "https://api.github.com/repos/kazwtto/youtube-client/releases?per_page=20";
pub const GITHUB_RELEASES_PAGE: &str = "https://github.com/kazwtto/youtube-client/releases";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_name: Option<String>,
    pub release_notes: Option<String>,
    pub release_url: String,
    pub download_url: Option<String>,
    pub published_at: Option<String>,
    pub is_prerelease: bool,
    pub update_available: bool,
    pub checked_at: i64,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    draft: bool,
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedVersion {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Option<String>,
}

fn parse_version(raw: &str) -> Option<ParsedVersion> {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);
    let without_build = trimmed.split('+').next().unwrap_or(trimmed);
    let mut parts = without_build.splitn(2, '-');
    let core = parts.next()?;
    let prerelease = parts
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);

    let mut nums = core.split('.');
    let major = nums.next()?.parse::<u64>().ok()?;
    let minor = nums.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let patch = nums.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);

    Some(ParsedVersion {
        major,
        minor,
        patch,
        prerelease,
    })
}

fn compare_prerelease(a: &str, b: &str) -> Ordering {
    let mut left = a.split('.');
    let mut right = b.split('.');
    loop {
        match (left.next(), right.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(l), Some(r)) => {
                let ord = match (l.parse::<u64>(), r.parse::<u64>()) {
                    (Ok(ln), Ok(rn)) => ln.cmp(&rn),
                    (Ok(_), Err(_)) => Ordering::Less,
                    (Err(_), Ok(_)) => Ordering::Greater,
                    (Err(_), Err(_)) => l.cmp(r),
                };
                if ord != Ordering::Equal {
                    return ord;
                }
            }
        }
    }
}

fn compare_versions(a: &ParsedVersion, b: &ParsedVersion) -> Ordering {
    (a.major, a.minor, a.patch)
        .cmp(&(b.major, b.minor, b.patch))
        .then_with(|| match (&a.prerelease, &b.prerelease) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (Some(la), Some(rb)) => compare_prerelease(la, rb),
        })
}

pub fn is_newer_version(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => compare_versions(&l, &c) == Ordering::Greater,
        _ => latest.trim().trim_start_matches(['v', 'V']) != current.trim().trim_start_matches(['v', 'V']),
    }
}

fn pick_windows_asset_url(assets: &[GithubAsset]) -> Option<String> {
    let preferred_exts = [".exe", ".msi", ".zip"];
    for ext in preferred_exts {
        if let Some(asset) = assets
            .iter()
            .find(|a| a.name.to_ascii_lowercase().ends_with(ext))
        {
            return Some(asset.browser_download_url.clone());
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn fetch_releases_json() -> AppResult<String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    let url_wide: Vec<u16> = std::ffi::OsStr::new(GITHUB_RELEASES_API)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let agent = format!("YT-Desktop/{}", env!("CARGO_PKG_VERSION"));
    let agent_wide: Vec<u16> = std::ffi::OsStr::new(&agent)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let headers_str = "Accept: application/vnd.github+json\r\nX-GitHub-Api-Version: 2022-11-28\r\n";
    let headers_wide: Vec<u16> = std::ffi::OsStr::new(headers_str)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    #[link(name = "wininet")]
    extern "system" {
        fn InternetOpenW(
            lpszAgent: *const u16,
            dwAccessType: u32,
            lpszProxy: *const u16,
            lpszProxyBypass: *const u16,
            dwFlags: u32,
        ) -> *mut c_void;
        fn InternetOpenUrlW(
            hInternet: *mut c_void,
            lpszUrl: *const u16,
            lpszHeaders: *const u16,
            dwHeadersLength: u32,
            dwFlags: u32,
            dwContext: usize,
        ) -> *mut c_void;
        fn InternetReadFile(
            hFile: *mut c_void,
            lpBuffer: *mut u8,
            dwNumberOfBytesToRead: u32,
            lpdwNumberOfBytesRead: *mut u32,
        ) -> i32;
        fn InternetSetOptionW(
            hInternet: *mut c_void,
            option: u32,
            buffer: *const c_void,
            length: u32,
        ) -> i32;
        fn HttpQueryInfoW(
            hRequest: *mut c_void,
            dwInfoLevel: u32,
            lpBuffer: *mut c_void,
            lpdwBufferLength: *mut u32,
            lpdwIndex: *mut u32,
        ) -> i32;
        fn InternetCloseHandle(hInternet: *mut c_void) -> i32;
    }

    unsafe {
        let h_internet = InternetOpenW(
            agent_wide.as_ptr(),
            0,
            std::ptr::null(),
            std::ptr::null(),
            0,
        );
        if h_internet.is_null() {
            return Err(AppError::Other("failed to initialize network session".into()));
        }

        let timeout_ms = 8_000u32;
        for option in [2u32, 5, 6] {
            let _ = InternetSetOptionW(
                h_internet,
                option,
                &timeout_ms as *const _ as *const c_void,
                std::mem::size_of_val(&timeout_ms) as u32,
            );
        }

        // INTERNET_FLAG_RELOAD | INTERNET_FLAG_NO_CACHE_WRITE | INTERNET_FLAG_SECURE
        let flags = 0x8000_0000u32 | 0x0400_0000u32 | 0x0080_0000u32;
        let h_url = InternetOpenUrlW(
            h_internet,
            url_wide.as_ptr(),
            headers_wide.as_ptr(),
            (headers_wide.len().saturating_sub(1)) as u32,
            flags,
            0,
        );

        if h_url.is_null() {
            InternetCloseHandle(h_internet);
            return Err(AppError::Other("could not reach GitHub releases".into()));
        }

        // HTTP_QUERY_STATUS_CODE (19) | HTTP_QUERY_FLAG_NUMBER (0x20000000)
        let mut status_code = 0u32;
        let mut status_len = std::mem::size_of::<u32>() as u32;
        let has_status = HttpQueryInfoW(
            h_url,
            19u32 | 0x2000_0000u32,
            &mut status_code as *mut u32 as *mut c_void,
            &mut status_len,
            std::ptr::null_mut(),
        ) != 0;

        let mut buffer = Vec::new();
        let mut chunk = [0u8; 8192];
        let mut bytes_read = 0u32;
        while InternetReadFile(
            h_url,
            chunk.as_mut_ptr(),
            chunk.len() as u32,
            &mut bytes_read,
        ) != 0
            && bytes_read > 0
        {
            buffer.extend_from_slice(&chunk[..bytes_read as usize]);
            if buffer.len() > 2 * 1024 * 1024 {
                break;
            }
        }

        InternetCloseHandle(h_url);
        InternetCloseHandle(h_internet);

        let body = String::from_utf8(buffer)
            .map_err(|_| AppError::Other("invalid response encoding".into()))?;

        if has_status && !(200..300).contains(&status_code) {
            let api_msg = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from));
            let detail = match api_msg {
                Some(msg) if !msg.is_empty() => format!("GitHub API HTTP {status_code}: {msg}"),
                _ => format!("GitHub API HTTP {status_code}"),
            };
            return Err(AppError::Other(detail));
        }

        Ok(body)
    }
}

#[cfg(not(target_os = "windows"))]
fn fetch_releases_json() -> AppResult<String> {
    let output = std::process::Command::new("curl")
        .args([
            "-fsSL",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            &format!("User-Agent: YT-Desktop/{}", env!("CARGO_PKG_VERSION")),
            GITHUB_RELEASES_API,
        ])
        .output()?;
    if !output.status.success() {
        return Err(AppError::Other("could not reach GitHub releases".into()));
    }
    String::from_utf8(output.stdout).map_err(|_| AppError::Other("invalid response encoding".into()))
}

pub async fn run_update_check(
    app: &AppHandle,
    include_prerelease: bool,
) -> AppResult<UpdateCheckResult> {
    let raw = tauri::async_runtime::spawn_blocking(fetch_releases_json)
        .await
        .map_err(|e| AppError::Other(e.to_string()))??;

    let releases: Vec<GithubRelease> = serde_json::from_str(&raw)
        .map_err(|_| AppError::Other("unexpected GitHub releases response".into()))?;

    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let checked_at = crate::rpc::model::now_millis();

    let candidate = releases
        .into_iter()
        .filter(|r| !r.draft && (include_prerelease || !r.prerelease))
        .max_by(|a, b| match (parse_version(&a.tag_name), parse_version(&b.tag_name)) {
            (Some(va), Some(vb)) => compare_versions(&va, &vb),
            _ => a.published_at.cmp(&b.published_at),
        });

    let result = if let Some(release) = candidate {
        let clean_tag = release.tag_name.trim().trim_start_matches(['v', 'V']).to_string();
        let update_available = is_newer_version(&release.tag_name, &current_version);
        let download_url = pick_windows_asset_url(&release.assets)
            .or_else(|| Some(release.html_url.clone()));
        UpdateCheckResult {
            current_version,
            latest_version: Some(clean_tag),
            release_name: release.name.filter(|s| !s.trim().is_empty()),
            release_notes: release.body.filter(|s| !s.trim().is_empty()),
            release_url: release.html_url,
            download_url,
            published_at: release.published_at,
            is_prerelease: release.prerelease,
            update_available,
            checked_at,
        }
    } else {
        UpdateCheckResult {
            current_version,
            latest_version: None,
            release_name: None,
            release_notes: None,
            release_url: GITHUB_RELEASES_PAGE.to_string(),
            download_url: None,
            published_at: None,
            is_prerelease: false,
            update_available: false,
            checked_at,
        }
    };

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut guard) = state.last_update_check.lock() {
            *guard = Some(result.clone());
        }
    }
    let _ = app.emit("updates://status", &result);
    Ok(result)
}

#[tauri::command]
pub async fn updates_check(
    app: AppHandle,
    state: State<'_, AppState>,
    include_prerelease: Option<bool>,
) -> AppResult<UpdateCheckResult> {
    let include = include_prerelease.unwrap_or_else(|| {
        state
            .settings
            .read()
            .map(|s| s.snapshot().updates.include_prerelease)
            .unwrap_or(true)
    });
    run_update_check(&app, include).await
}

#[tauri::command]
pub fn updates_last_status(state: State<'_, AppState>) -> Option<UpdateCheckResult> {
    state
        .last_update_check
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

#[tauri::command]
pub fn updates_open_url(url: String) -> AppResult<()> {
    let trimmed = url.trim();
    let allowed = trimmed.starts_with("https://github.com/kazwtto/youtube-client")
        || trimmed.starts_with("https://objects.githubusercontent.com/");
    if !allowed {
        return Err(AppError::Other("blocked update URL".into()));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .creation_flags(0x08000000)
            .spawn()?;
    }

    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(trimmed).spawn()?;

    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open").arg(trimmed).spawn()?;

    Ok(())
}
