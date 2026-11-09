//! Taskbar integration for windows created by this app's WebView2 processes.

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::ptr::null_mut;

use tauri::{Manager, Webview, Window};
use windows::Win32::{
    Foundation::{HWND, PROPERTYKEY},
    System::{Com::StructuredStorage::PROPVARIANT, Variant::VT_LPWSTR},
    UI::Shell::{
        PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow},
        SHStrDupW,
    },
};
use windows_core::{GUID, HSTRING};

type Handle = *mut c_void;

const EVENT_OBJECT_SHOW: u32 = 0x8002;
const EVENT_OBJECT_NAMECHANGE: u32 = 0x800C;
const EVENT_OBJECT_CREATE: u32 = 0x8000;
const GA_ROOT: u32 = 2;
const GWL_EXSTYLE: i32 = -20;
const WS_EX_TOOLWINDOW: isize = 0x80;
const WS_EX_APPWINDOW: isize = 0x40000;
const APP_ID_KEY: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
    pid: 5,
};

#[link(name = "user32")]
extern "system" {
    fn SetWinEventHook(
        first: u32,
        last: u32,
        module: Handle,
        callback: unsafe extern "system" fn(Handle, u32, Handle, i32, i32, u32, u32),
        process: u32,
        thread: u32,
        flags: u32,
    ) -> Handle;
    fn UnhookWinEvent(hook: Handle) -> i32;
    fn GetAncestor(hwnd: Handle, flags: u32) -> Handle;
    fn GetClassNameW(hwnd: Handle, text: *mut u16, capacity: i32) -> i32;
    fn GetWindowTextW(hwnd: Handle, text: *mut u16, capacity: i32) -> i32;
    fn GetWindowLongPtrW(hwnd: Handle, index: i32) -> isize;
    fn SetWindowLongPtrW(hwnd: Handle, index: i32, value: isize) -> isize;
}

struct Watch {
    owner: Handle,
    hook: Handle,
    app_id: String,
}

impl Drop for Watch {
    fn drop(&mut self) {
        unsafe { UnhookWinEvent(self.hook) };
    }
}

thread_local! {
    // SetWinEventHook dispatches out-of-process events on the registering UI thread.
    static WATCHES: RefCell<HashMap<u32, Watch>> = RefCell::new(HashMap::new());
}

pub fn watch(owner: &Window, webview: &Webview) {
    let Ok(hwnd) = owner.hwnd() else { return };
    let owner = hwnd.0 as isize;
    let app_id = webview.config().identifier.clone();
    let _ = set_app_id(hwnd.0, &app_id);
    let _ = webview.with_webview(move |platform| {
        let mut process = 0;
        unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else {
                return;
            };
            if core.BrowserProcessId(&mut process).is_err() || process == 0 {
                return;
            }
        }

        WATCHES.with(|watches| {
            let mut watches = watches.borrow_mut();
            if watches.contains_key(&process) {
                return;
            }
            let hook = unsafe {
                SetWinEventHook(
                    EVENT_OBJECT_CREATE,
                    EVENT_OBJECT_NAMECHANGE,
                    null_mut(),
                    on_window_event,
                    process,
                    0,
                    0,
                )
            };
            if !hook.is_null() {
                watches.insert(
                    process,
                    Watch {
                        owner: owner as Handle,
                        hook,
                        app_id: app_id.clone(),
                    },
                );
            }
        });
    });
}

pub fn unwatch(owner: &Window) {
    if let Ok(hwnd) = owner.hwnd() {
        WATCHES.with(|watches| {
            watches
                .borrow_mut()
                .retain(|_, watch| watch.owner != hwnd.0)
        });
    }
}

unsafe extern "system" fn on_window_event(
    hook: Handle,
    event: u32,
    hwnd: Handle,
    object: i32,
    child: i32,
    _: u32,
    _: u32,
) {
    if !matches!(
        event,
        EVENT_OBJECT_CREATE | EVENT_OBJECT_SHOW | EVENT_OBJECT_NAMECHANGE
    ) || object != 0
        || child != 0
        || hwnd.is_null()
        || GetAncestor(hwnd, GA_ROOT) != hwnd
    {
        return;
    }

    let mut class = [0; 32];
    let length = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
    if length <= 0
        || !String::from_utf16_lossy(&class[..length as usize]).starts_with("Chrome_WidgetWin_")
    {
        return;
    }
    let mut title = [0; 32];
    let length = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32);
    if length <= 0 {
        return;
    }

    let title = String::from_utf16_lossy(&title[..length as usize]).to_lowercase();
    if title.starts_with("devtools") {
        WATCHES.with(|watches| {
            if let Some(watch) = watches.borrow().values().find(|watch| watch.hook == hook) {
                let _ = set_app_id(hwnd, &watch.app_id);
            }
        });
    } else if matches!(
        title.as_str(),
        "picture-in-picture" | "picture in picture" | "imagem em imagem"
    ) {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let updated = (style | WS_EX_TOOLWINDOW) & !WS_EX_APPWINDOW;
        if updated != style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, updated);
        }
    }
}

fn set_app_id(hwnd: Handle, app_id: &str) -> windows_core::Result<()> {
    unsafe {
        let store: IPropertyStore = SHGetPropertyStoreForWindow(HWND(hwnd))?;
        let text = SHStrDupW(&HSTRING::from(app_id))?;
        let mut value = PROPVARIANT::default();
        let string = &mut *value.Anonymous.Anonymous;
        string.vt = VT_LPWSTR;
        string.Anonymous.pwszVal = text;
        store.SetValue(&APP_ID_KEY, &value)?;
        store.Commit()
    }
}
