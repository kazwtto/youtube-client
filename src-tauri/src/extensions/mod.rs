pub mod manifest;
pub mod permissions;
#[cfg(windows)]
pub mod runtime;
pub mod service;

pub use service::{ExtensionService, ExtensionSummary};

/// Reconciles the WebView2 profile with the enabled extensions.
///
/// Returns `true` when the profile changed, in which case the caller must
/// recreate the YouTube webview for the change to take effect.
#[cfg(windows)]
pub fn apply_runtime(window: &tauri::Window, extensions: &[ExtensionSummary]) -> bool {
    match runtime::sync(window, extensions) {
        Ok(changed) => changed,
        Err(error) => {
            eprintln!("extensions: {error}");
            false
        }
    }
}

#[cfg(not(windows))]
pub fn apply_runtime(_window: &tauri::Window, _extensions: &[ExtensionSummary]) -> bool {
    false
}
