use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
    DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

const WINDOWS_APP_ICON_RESOURCE_ID: u16 = 32_512;
const ICON_REFRESH_INTERVAL: Duration = Duration::from_secs(3);

/// Schedules a throttled scan after YouTube reports active playback. WebView2
/// owns the audio session in a child process, so its default mixer icon is not
/// the icon embedded in this app's executable.
pub fn refresh_session_icon() {
    static LAST_SCAN: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

    let now = Instant::now();
    let Some(mut last_scan) = LAST_SCAN.get_or_init(|| Mutex::new(None)).lock().ok() else {
        return;
    };
    if last_scan.is_some_and(|last| now.duration_since(last) < ICON_REFRESH_INTERVAL) {
        return;
    }
    *last_scan = Some(now);
    drop(last_scan);

    let _ = std::thread::Builder::new()
        .name("audio-session-icon".into())
        .spawn(|| unsafe {
            apply_icon_to_app_sessions();
        });
}

unsafe fn apply_icon_to_app_sessions() {
    let initialized = CoInitializeEx(None, COINIT_MULTITHREADED);
    if initialized.is_err() {
        return;
    }
    let _com = ComGuard;

    let Ok(executable) = std::env::current_exe() else {
        return;
    };
    let icon_path = format!("{},-{}", executable.display(), WINDOWS_APP_ICON_RESOURCE_ID);
    let mut icon_path_wide: Vec<u16> = icon_path.encode_utf16().collect();
    icon_path_wide.push(0);

    let process_parents = process_parent_map();
    let app_pid = std::process::id();
    let Ok(devices) =
        CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .and_then(|enumerator| enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE))
    else {
        return;
    };

    let Ok(device_count) = devices.GetCount() else {
        return;
    };

    for device_index in 0..device_count {
        let Ok(device) = devices.Item(device_index) else {
            continue;
        };
        let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
            continue;
        };
        let Ok(sessions) = manager.GetSessionEnumerator() else {
            continue;
        };
        let Ok(session_count) = sessions.GetCount() else {
            continue;
        };

        for session_index in 0..session_count {
            let Ok(session) = sessions.GetSession(session_index) else {
                continue;
            };
            let Ok(control) = session.cast::<IAudioSessionControl2>() else {
                continue;
            };
            let Ok(session_pid) = control.GetProcessId() else {
                continue;
            };
            if !is_app_process(session_pid, app_pid, &process_parents) {
                continue;
            }

            if let Ok(current_icon) = control.GetIconPath() {
                let current_icon_path = current_icon.to_string().unwrap_or_default();
                CoTaskMemFree(Some(current_icon.0.cast::<c_void>()));
                if current_icon_path.eq_ignore_ascii_case(&icon_path) {
                    continue;
                }
            }

            let _ = control.SetIconPath(PCWSTR(icon_path_wide.as_ptr()), std::ptr::null());
        }
    }
}

struct ComGuard;

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn process_parent_map() -> HashMap<u32, u32> {
    let mut parents = HashMap::new();
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
        return parents;
    };

    let mut entry = PROCESSENTRY32W::default();
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok();
    while has_entry {
        parents.insert(entry.th32ProcessID, entry.th32ParentProcessID);
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) }.is_ok();
    }
    let _ = unsafe { CloseHandle(snapshot) };
    parents
}

fn is_app_process(process_id: u32, app_pid: u32, parents: &HashMap<u32, u32>) -> bool {
    let mut current = process_id;
    for _ in 0..64 {
        if current == app_pid {
            return true;
        }
        let Some(parent) = parents.get(&current).copied() else {
            return false;
        };
        if parent == 0 || parent == current {
            return false;
        }
        current = parent;
    }
    false
}
