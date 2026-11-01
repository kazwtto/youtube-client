//! Runtime synchronization of WebView2 browser extensions.
//!
//! WRY only reads the extension folders when a webview is created, and only
//! from the configured extension path. Disabling an extension therefore cannot
//! be done by moving its folder: the WebView2 profile keeps the extension
//! installed until it is explicitly removed. This module talks to the
//! `ICoreWebView2Profile7` interface of the running webview to add and remove
//! extensions, and keeps the profile in sync with the app settings.

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Manager;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2BrowserExtension, ICoreWebView2BrowserExtensionList, ICoreWebView2Profile7,
    ICoreWebView2_13,
};
use webview2_com::{
    BrowserExtensionRemoveCompletedHandler, CoTaskMemPWSTR,
    ProfileAddBrowserExtensionCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler,
};
use windows_core::{Interface, HSTRING, PWSTR};

use crate::core::error::{AppError, AppResult};
use crate::extensions::ExtensionSummary;
use crate::window::layout::YOUTUBE_WEBVIEW_LABEL;

type Outcome = Result<bool, String>;

/// Reconciles the WebView2 profile with the set of enabled extensions.
///
/// Enabled extensions missing from the profile are added, and extensions owned
/// by the app that are disabled are removed. Extensions that the app does not
/// manage (for example, components shipped with the WebView2 runtime) are left
/// untouched. Returns `true` when the profile changed, so the caller can
/// recreate the webview.
pub fn sync(window: &tauri::Window, extensions: &[ExtensionSummary]) -> AppResult<bool> {
    let desired: HashMap<String, PathBuf> = extensions
        .iter()
        .filter(|extension| extension.enabled)
        .map(|extension| (extension.name.clone(), PathBuf::from(&extension.path)))
        .collect();

    let disabled: BTreeSet<String> = extensions
        .iter()
        .filter(|extension| !extension.enabled)
        .map(|extension| extension.name.clone())
        .collect();

    let webview = window
        .get_webview(YOUTUBE_WEBVIEW_LABEL)
        .ok_or_else(|| AppError::NotFound("YouTube webview".into()))?;

    let (sender, receiver) = mpsc::channel::<Outcome>();

    webview
        .with_webview(move |platform| {
            if let Err(error) = reconcile(&platform, desired, disabled, sender.clone()) {
                let _ = sender.send(Err(error));
            }
        })
        .map_err(AppError::from)?;

    match receiver.recv_timeout(Duration::from_secs(20)) {
        Ok(Ok(changed)) => Ok(changed),
        Ok(Err(error)) => Err(AppError::Other(error)),
        Err(_) => Err(AppError::Other(
            "timed out while updating WebView2 extensions".into(),
        )),
    }
}

fn reconcile(
    platform: &tauri::webview::PlatformWebview,
    desired: HashMap<String, PathBuf>,
    disabled: BTreeSet<String>,
    sender: Sender<Outcome>,
) -> Result<(), String> {
    let controller = platform.controller();
    let core = unsafe { controller.CoreWebView2() }.map_err(|error| error.to_string())?;
    let profile = unsafe {
        core.cast::<ICoreWebView2_13>()
            .map_err(|error| error.to_string())?
            .Profile()
            .map_err(|error| error.to_string())?
            .cast::<ICoreWebView2Profile7>()
            .map_err(|error| error.to_string())?
    };

    let list_profile = profile.clone();
    let list_sender = sender.clone();
    let handler =
        ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |result, list| {
            let outcome = result
                .map_err(|error| error.to_string())
                .and_then(|_| list.ok_or_else(|| "the extension list is unavailable".to_string()))
                .and_then(|list| {
                    reconcile_list(&list_profile, &desired, &disabled, &list, &list_sender)
                });

            if let Err(error) = outcome {
                let _ = list_sender.send(Err(error));
            }

            Ok(())
        }));

    unsafe { profile.GetBrowserExtensions(&handler) }.map_err(|error| error.to_string())
}

fn reconcile_list(
    profile: &ICoreWebView2Profile7,
    desired: &HashMap<String, PathBuf>,
    disabled: &BTreeSet<String>,
    list: &ICoreWebView2BrowserExtensionList,
    sender: &Sender<Outcome>,
) -> Result<(), String> {
    let mut installed: Vec<(String, ICoreWebView2BrowserExtension)> = Vec::new();
    let mut installed_names = BTreeSet::new();

    let mut count = 0u32;
    unsafe { list.Count(&mut count) }.map_err(|error| error.to_string())?;

    for index in 0..count {
        let extension =
            unsafe { list.GetValueAtIndex(index) }.map_err(|error| error.to_string())?;
        let name = read_name(&extension)?;
        installed_names.insert(name.clone());
        installed.push((name, extension));
    }

    let removals: Vec<ICoreWebView2BrowserExtension> = installed
        .into_iter()
        .filter(|(name, _)| disabled.contains(name))
        .map(|(_, extension)| extension)
        .collect();

    let additions: Vec<PathBuf> = desired
        .iter()
        .filter(|(name, _)| !installed_names.contains(*name))
        .map(|(_, path)| path.clone())
        .collect();

    let total = removals.len() + additions.len();
    if total == 0 {
        let _ = sender.send(Ok(false));
        return Ok(());
    }

    let remaining = Arc::new(AtomicUsize::new(total));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));

    for extension in removals {
        let handler = {
            let remaining = remaining.clone();
            let errors = errors.clone();
            let sender = sender.clone();
            BrowserExtensionRemoveCompletedHandler::create(Box::new(move |result| {
                if let Err(error) = result {
                    record_error(&errors, error.to_string());
                }
                finish(&remaining, &errors, &sender);
                Ok(())
            }))
        };

        if let Err(error) = unsafe { extension.Remove(&handler) } {
            record_error(&errors, error.to_string());
            finish(&remaining, &errors, sender);
        }
    }

    for path in additions {
        let handler = {
            let remaining = remaining.clone();
            let errors = errors.clone();
            let sender = sender.clone();
            ProfileAddBrowserExtensionCompletedHandler::create(Box::new(
                move |result, _extension| {
                    if let Err(error) = result {
                        record_error(&errors, error.to_string());
                    }
                    finish(&remaining, &errors, &sender);
                    Ok(())
                },
            ))
        };

        let path = HSTRING::from(path.as_path());
        if let Err(error) = unsafe { profile.AddBrowserExtension(&path, &handler) } {
            record_error(&errors, error.to_string());
            finish(&remaining, &errors, sender);
        }
    }

    Ok(())
}

fn read_name(extension: &ICoreWebView2BrowserExtension) -> Result<String, String> {
    let mut name = PWSTR::null();
    unsafe { extension.Name(&mut name) }.map_err(|error| error.to_string())?;
    Ok(CoTaskMemPWSTR::from(name).to_string())
}

fn record_error(errors: &Mutex<Vec<String>>, error: String) {
    if let Ok(mut errors) = errors.lock() {
        errors.push(error);
    }
}

/// Reports the outcome once every add/remove operation has completed.
fn finish(remaining: &AtomicUsize, errors: &Mutex<Vec<String>>, sender: &Sender<Outcome>) {
    if remaining.fetch_sub(1, Ordering::SeqCst) != 1 {
        return;
    }

    let result = match errors.lock() {
        Ok(errors) if errors.is_empty() => Ok(true),
        Ok(errors) => Err(errors.join("; ")),
        Err(_) => Err("could not update extensions".to_string()),
    };

    let _ = sender.send(result);
}
