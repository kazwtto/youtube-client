fn main() {
    // Declaring the commands generates an `allow-<command>` permission for each
    // of them. The permissions are required because the scripts injected into
    // the YouTube webview (a remote origin) call `theme_get` and
    // `player_snapshot`: Tauri only lets remote content reach the IPC when a
    // capability with a matching `remote` URL explicitly allows the command.
    // Declaring the app manifest also means every command must be allowed by a
    // capability, so `capabilities/default.json` lists them for the local UI.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "app_version",
            "set_webview_visible",
            "yt_navigate",
            "yt_play_video",
            "pip_open",
            "pip_close",
            "pip_next",
            "pip_current",
            "pip_set_ratio",
            "pip_drag_start",
            "pip_move_by",
            "pip_drag_end",
            "pip_restore",
            "pip_sync_time",
            "show_context_menu",
            "hide_context_menu",
            "is_context_menu_visible",
            "open_auth_modal",
            "close_auth_modal",
            "reload_auth_modal",
            "back_auth_modal",
            "is_auth_modal_visible",
            "theme_list",
            "theme_get",
            "settings_get",
            "settings_update",
            "extensions_list",
            "extensions_install",
            "extensions_uninstall",
            "extensions_set_enabled",
            "rpc_status",
            "history_list",
            "history_clear",
            "history_delete",
            "player_snapshot",
            "auth_snapshot",
            "native_pip_return",
        ]),
    ))
    .expect("failed to run tauri-build");
}
