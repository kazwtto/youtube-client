# YT Desktop

A YouTube desktop client written in Rust, built with Tauri v2 and WebView2.
Planned and in-progress features: Fluent themes with Mica/Acrylic, Chromium and
native extensions, offline history in SQLite, and Discord Rich Presence modeled
after
[YouTubeDiscordPresence](https://github.com/XFG16/YouTubeDiscordPresence).

> **Status:** foundation under development. The window, themes, extensions, and
> history already have a backend and UI; the player and RPC are connected by the
> observer injected into YouTube.

## Stack

- **Tauri v2** (Rust + WebView2), targeting Windows 11 (Windows 10 fallback).
- **Vite + TypeScript** for the local UI.
- **YouTube** loaded in a child webview (`yt`), with WebView2 extensions.
- **SQLite/sqlx** for offline history.
- **Discord RPC** via `discord-rich-presence`.

## Requirements

- Windows 10/11 with **WebView2 Evergreen**.
- [Rust](https://rustup.rs/) 1.77+.
- [Node.js](https://nodejs.org/) 20+.
- Visual Studio Build Tools with the "Desktop development with C++" workload.

## Running

```bash
npm install
npm run tauri:dev
```

Production build:

```bash
npm run tauri:build
```

The provisional icon lives in `src-tauri/icons/` and was generated from
`assets/branding/icon-source.png`. To replace it, run:

```bash
npm run tauri:icon path/to/icon.png
```

## Architecture

### Backend (`src-tauri/src`)

Each domain has its own model, service, and commands. Commands only orchestrate
the services; business rules live in the domain modules.

| Module | Responsibility |
| --- | --- |
| `core` | Errors, events, paths, and shared state. |
| `settings` | Typed model and atomic persistence of `settings.json`. |
| `theme` | Built-in themes, CSS tokens, Mica/Acrylic, and YouTube sync. |
| `extensions` | Manifests, permissions, discovery, installation, and removal. |
| `player` | Player state received from the observer. |
| `rpc` | Activity construction and Discord IPC transport. |
| `history` | SQLite repository, migrations, and FTS5. |
| `window` | Borderless window and webview positioning. |
| `commands` | IPC surface exposed to the UI. |

### Frontend (`src`)

| Folder | Responsibility |
| --- | --- |
| `app` | Bootstrap, shell, and router. |
| `components` | Title bar and sidebar navigation. |
| `pages` | Home, settings, history, extensions, and RPC. |
| `theme` | Token application and `theme://changed` listener. |
| `lib` | Types and typed IPC wrappers. |
| `styles` | Tokens, base, components, and pages. |

### Local data

Under `%APPDATA%\com.ytdesktop.client\`:

- `settings.json` — app preferences.
- `history.db` — SQLite history.
- `extensions/` — installed extensions.
- `thumbnails/` — thumbnails kept locally.

## Themes

The theme system has three layers:

1. **Definition** (`theme/registry.rs`): light and dark palettes, name, and description.
2. **Resolution** (`theme/service.rs`): combines theme, mode (`system`/`light`/`dark`),
   accent color, radius, and motion into a token set.
3. **Application**: CSS tokens in the UI, `Mica`/`Acrylic`/`Solid` on the native
   window, and synchronized CSS in the YouTube webview.

Built-in themes: `fluent` and `high-contrast`. The UI uses the variables
`--color-bg`, `--color-fg`, `--color-accent`, `--radius-*`, and `--motion-*`.

## Localization

The UI ships with English and Portuguese (Brazil) dictionaries in `src/i18n`.
Typed locale files keep both languages in sync, and the selected language is
persisted in `settings.json`. Change it in **Settings → Appearance → Language**.
Discord presence labels use the same language.

## Extensions

The app accepts two formats in the same folder:

- **Chromium Manifest V3** (`manifest.json`), loaded directly by WebView2.
- **Native extension** (`ytapp.json`), with declarative permissions:

```json
{
  "id": "my-extension",
  "name": "My extension",
  "version": "1.0.0",
  "description": "Example native extension.",
  "permissions": ["player.read", "theme.read"],
  "main": "content.js"
}
```

Available permissions: `player.read`, `player.control`, `history.read`,
`history.write`, `rpc.read`, `rpc.write`, `titlebar.buttons`, `storage`,
`theme.read`, and `theme.write`.

Flow: install from folder → validate manifest → copy to the data directory
→ enable/disable in `settings.json` → load on the next webview launch.
Invalid extensions are ignored during listing.

## Discord Rich Presence

The observer in `injected/observer.js` reads the player every two seconds and
sends `player_snapshot` to the backend. The backend builds the activity with
title, channel, time, thumbnail, and up to two buttons, applying a 15-second
rate limit between updates. Without a video — or while paused with
`idleWhenPaused` enabled — the presence is cleared.

The Application ID is configurable in **Settings → Discord Rich Presence**.

## History

The database uses `sqlx` migrations, with `videos`, `watch_events`, indexes, and
an FTS5 table synchronized by triggers. Queries aggregate by video and sort by
last access.

## IPC commands

`app_version`, `set_webview_visible`, `yt_navigate`, `theme_list`, `theme_get`,
`theme_update`, `settings_get`, `settings_update`, `extensions_list`,
`extensions_install`, `extensions_uninstall`, `extensions_set_enabled`,
`rpc_status`, `rpc_update`, `history_list`, `history_clear`, `history_delete`,
and `player_snapshot`.

## Notice

The app loads the official YouTube website in a webview. It does not remove ads
or download videos. Use is subject to YouTube's Terms of Service.

## License

To be defined. The YTDP reference is MIT.