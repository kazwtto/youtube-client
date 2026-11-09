fn main() {
    // Declaring the commands generates an `allow-<command>` permission for each
    // of them. The permissions are required because the scripts injected into
    // the YouTube webview (a remote origin) call `theme_get` and
    // `player_snapshot`, resume progress, and remember the last page: Tauri
    // only lets remote content reach IPC when a matching remote capability
    // explicitly allows each command.
    // Declaring the app manifest also means every command must be allowed by a
    // capability, so `capabilities/default.json` lists them for the local UI.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "browser_data_sources",
            "browser_history_import",
            "open_repository",
            "app_version",
            "set_webview_visible",
            "set_launcher_route_active",
            "yt_navigate",
            "yt_play_video",
            "yt_suggest",
            "remember_youtube_page",
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
            "extensions_refresh",
            "extensions_install",
            "extensions_uninstall",
            "extensions_set_enabled",
            "rpc_status",
            "history_list",
            "history_resume_position",
            "history_clear",
            "history_delete",
            "player_snapshot",
            "auth_snapshot",
            "request_auth_snapshot",
            "youtube_loading_state",
            "youtube_surface_painted",
            "set_native_pip_active",
            "native_pip_return",
            "request_youtube_titlebar_icons",
            "youtube_titlebar_icons_snapshot",
            "set_masthead_integrated",
            "set_ui_elevation",
        ]),
    ))
    .expect("failed to run tauri-build");
}
