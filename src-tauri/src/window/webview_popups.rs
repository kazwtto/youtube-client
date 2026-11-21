//! Taskbar integration for windows created by this app's WebView2 processes.

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicU8, Ordering};

use tauri::{Manager, Webview, Window};
use windows::Win32::{
    Foundation::{HWND, POINT, PROPERTYKEY},
    System::{
        Com::StructuredStorage::PROPVARIANT,
        Variant::{VARIANT, VT_LPWSTR},
    },
    UI::{
        Accessibility::{AccessibleObjectFromPoint, IAccessible},
        Shell::{
            PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow},
            SHStrDupW,
        },
    },
};
use windows_core::{GUID, HSTRING, Interface};

type Handle = *mut c_void;

const EVENT_SYSTEM_CAPTURESTART: u32 = 0x0008;
const EVENT_SYSTEM_MINIMIZESTART: u32 = 0x0016;
const EVENT_OBJECT_CREATE: u32 = 0x8000;
const EVENT_OBJECT_SHOW: u32 = 0x8002;
const EVENT_OBJECT_HIDE: u32 = 0x8003;
const EVENT_OBJECT_LOCATIONCHANGE: u32 = 0x800B;
const EVENT_OBJECT_NAMECHANGE: u32 = 0x800C;
const EVENT_OBJECT_INVOKED: u32 = 0x8013;
const GA_ROOT: u32 = 2;
const GWL_EXSTYLE: i32 = -20;
const WS_EX_TOOLWINDOW: isize = 0x80;
const WS_EX_APPWINDOW: isize = 0x40000;
const APP_ID_KEY: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
    pid: 5,
};

const RETURN_UNKNOWN: u8 = 0;
const RETURN_ALLOW: u8 = 1;
const RETURN_SUPPRESS: u8 = 2;

#[repr(C)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

static LAST_PIP_HWND: AtomicIsize = AtomicIsize::new(0);
static NATIVE_PIP_MINIMIZED: AtomicBool = AtomicBool::new(false);
static NATIVE_PIP_RETURN_MODE: AtomicU8 = AtomicU8::new(RETURN_UNKNOWN);
static PIP_LEFT: AtomicI32 = AtomicI32::new(0);
static PIP_TOP: AtomicI32 = AtomicI32::new(0);
static PIP_RIGHT: AtomicI32 = AtomicI32::new(0);
static PIP_BOTTOM: AtomicI32 = AtomicI32::new(0);
static PIP_DPI: AtomicI32 = AtomicI32::new(96);

fn record_pip_bounds(hwnd: Handle) {
    let mut rect = Rect {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(hwnd, &mut rect) } != 0
        && rect.left > -10000
        && rect.top > -10000
        && rect.right > rect.left
        && rect.bottom > rect.top
    {
        PIP_LEFT.store(rect.left, Ordering::SeqCst);
        PIP_TOP.store(rect.top, Ordering::SeqCst);
        PIP_RIGHT.store(rect.right, Ordering::SeqCst);
        PIP_BOTTOM.store(rect.bottom, Ordering::SeqCst);
    }
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi > 0 {
        PIP_DPI.store(dpi as i32, Ordering::SeqCst);
    }
}

fn classify_button_name(name: &str) -> Option<u8> {
    if name.contains("minimizar")
        || name.contains("minimize")
        || name.contains("ocultar")
        || name.contains("hide")
        || name.contains("recolher")
        || name.contains("collapse")
        || name.contains("fechar")
        || name.contains("close")
    {
        return Some(RETURN_SUPPRESS);
    }
    if name.contains("guia")
        || name.contains("tab")
        || name.contains("voltar")
        || name.contains("back")
        || name.contains("retornar")
        || name.contains("return")
        || name.contains("abrir")
        || name.contains("open")
    {
        return Some(RETURN_ALLOW);
    }
    None
}

fn inspect_pip_button_under_cursor() {
    let mut pt = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut pt) } == 0 {
        return;
    }

    let left = PIP_LEFT.load(Ordering::SeqCst);
    let top = PIP_TOP.load(Ordering::SeqCst);
    let right = PIP_RIGHT.load(Ordering::SeqCst);
    let bottom = PIP_BOTTOM.load(Ordering::SeqCst);
    if right <= left
        || bottom <= top
        || pt.x < left
        || pt.x > right
        || pt.y < top
        || pt.y > bottom
    {
        return;
    }

    let mut acc: Option<IAccessible> = None;
    let mut child = VARIANT::default();
    if unsafe { AccessibleObjectFromPoint(pt, &mut acc, &mut child) }.is_ok() {
        let mut current = acc;
        let mut current_child = child;
        for _ in 0..3 {
            let Some(node) = current.take() else {
                break;
            };
            if let Ok(name) = unsafe { node.get_accName(&current_child) } {
                let lower = name.to_string().to_lowercase();
                if let Some(mode) = classify_button_name(&lower) {
                    NATIVE_PIP_RETURN_MODE.store(mode, Ordering::SeqCst);
                    if mode == RETURN_SUPPRESS {
                        NATIVE_PIP_MINIMIZED.store(true, Ordering::SeqCst);
                    }
                    return;
                }
            }
            if let Ok(parent_disp) = unsafe { node.accParent() } {
                if let Ok(parent_acc) = parent_disp.cast::<IAccessible>() {
                    current = Some(parent_acc);
                    current_child = VARIANT::from(0i32);
                    continue;
                }
            }
            break;
        }
    }
}

fn cursor_in_minimize_button() -> bool {
    let left = PIP_LEFT.load(Ordering::SeqCst);
    let top = PIP_TOP.load(Ordering::SeqCst);
    let right = PIP_RIGHT.load(Ordering::SeqCst);
    let bottom = PIP_BOTTOM.load(Ordering::SeqCst);
    if right <= left || bottom <= top {
        return false;
    }

    let mut pt = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut pt) } == 0 {
        return false;
    }

    let dpi = PIP_DPI.load(Ordering::SeqCst).max(96) as f64;
    let scale = dpi / 96.0;
    let header_h = (52.0 * scale).round() as i32;
    let close_w = (40.0 * scale).round() as i32;
    let back_w = (36.0 * scale).round() as i32;
    let min_w = (52.0 * scale).round() as i32;

    if pt.y < top || pt.y > top + header_h {
        return false;
    }

    let in_top_left = pt.x >= left && pt.x <= left + min_w;
    let in_top_right_minimize =
        pt.x >= right - close_w - back_w - min_w && pt.x < right - close_w - back_w;
    in_top_left || in_top_right_minimize
}

pub fn clear_native_pip_minimized() {
    NATIVE_PIP_MINIMIZED.store(false, Ordering::SeqCst);
    NATIVE_PIP_RETURN_MODE.store(RETURN_UNKNOWN, Ordering::SeqCst);
}

pub fn take_native_pip_minimized() -> bool {
    let was_minimized = NATIVE_PIP_MINIMIZED.swap(false, Ordering::SeqCst);
    let mode = NATIVE_PIP_RETURN_MODE.swap(RETURN_UNKNOWN, Ordering::SeqCst);
    if was_minimized || mode == RETURN_SUPPRESS {
        return true;
    }
    if mode == RETURN_ALLOW {
        return false;
    }
    let hwnd = LAST_PIP_HWND.load(Ordering::SeqCst);
    if hwnd != 0 && unsafe { IsIconic(hwnd as Handle) != 0 } {
        return true;
    }
    cursor_in_minimize_button()
}

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
    fn IsIconic(hwnd: Handle) -> i32;
    fn GetWindowRect(hwnd: Handle, rect: *mut Rect) -> i32;
    fn GetCursorPos(point: *mut POINT) -> i32;
    fn GetDpiForWindow(hwnd: Handle) -> u32;
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
                    EVENT_SYSTEM_CAPTURESTART,
                    EVENT_OBJECT_INVOKED,
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
    if matches!(event, EVENT_SYSTEM_CAPTURESTART | EVENT_OBJECT_INVOKED) && !hwnd.is_null() {
        let pip_hwnd = LAST_PIP_HWND.load(Ordering::SeqCst);
        if pip_hwnd != 0 && GetAncestor(hwnd, GA_ROOT) as isize == pip_hwnd {
            inspect_pip_button_under_cursor();
        }
        return;
    }

    if event == EVENT_SYSTEM_MINIMIZESTART && object == 0 && child == 0 && !hwnd.is_null() {
        let root = GetAncestor(hwnd, GA_ROOT);
        if root == hwnd {
            let mut class = [0; 32];
            let length = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
            if length > 0
                && String::from_utf16_lossy(&class[..length as usize])
                    .starts_with("Chrome_WidgetWin_")
            {
                let mut title = [0; 128];
                let tlen = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32);
                let title = if tlen > 0 {
                    String::from_utf16_lossy(&title[..tlen as usize]).to_lowercase()
                } else {
                    String::new()
                };
                if !title.starts_with("devtools") {
                    NATIVE_PIP_MINIMIZED.store(true, Ordering::SeqCst);
                    NATIVE_PIP_RETURN_MODE.store(RETURN_SUPPRESS, Ordering::SeqCst);
                }
            }
        }
        return;
    }

    if event == EVENT_OBJECT_LOCATIONCHANGE
        && object == 0
        && child == 0
        && !hwnd.is_null()
        && hwnd as isize == LAST_PIP_HWND.load(Ordering::SeqCst)
    {
        record_pip_bounds(hwnd);
        return;
    }

    if event == EVENT_OBJECT_HIDE
        && object == 0
        && child == 0
        && !hwnd.is_null()
        && hwnd as isize == LAST_PIP_HWND.load(Ordering::SeqCst)
    {
        if NATIVE_PIP_RETURN_MODE.load(Ordering::SeqCst) == RETURN_UNKNOWN {
            inspect_pip_button_under_cursor();
        }
        if NATIVE_PIP_RETURN_MODE.load(Ordering::SeqCst) == RETURN_UNKNOWN
            && cursor_in_minimize_button()
        {
            NATIVE_PIP_MINIMIZED.store(true, Ordering::SeqCst);
            NATIVE_PIP_RETURN_MODE.store(RETURN_SUPPRESS, Ordering::SeqCst);
        }
        return;
    }

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
    let mut title = [0; 128];
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
    } else if title.contains("picture-in-picture")
        || title.contains("picture in picture")
        || title.contains("imagem em imagem")
    {
        LAST_PIP_HWND.store(hwnd as isize, Ordering::SeqCst);
        clear_native_pip_minimized();
        record_pip_bounds(hwnd);
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
