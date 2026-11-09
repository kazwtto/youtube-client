# Architecture

App is a Tauri 2 desktop application. Rust owns the native windowing, persistence, WebView lifecycle, and privileged operations. A SolidJS and TypeScript frontend renders the launcher and settings screens. Vite serves the frontend during development and builds the frontend assets for packaging.

## Startup and window layout

1. `src-tauri/src/main.rs` calls the library entry point in `src-tauri/src/lib.rs`.
2. Startup resolves app-specific directories, opens settings and the SQLite history database, and creates shared application state.
3. `src-tauri/src/window/layout.rs` builds the main native window and its launcher (`ui`) and YouTube (`yt`) WebViews. It also creates separate hidden windows/webviews for the menu, sign-in flow, and picture-in-picture player.
4. The launcher loads `index.html`; the other top-level UI surfaces have their own HTML entry points. The YouTube WebView loads YouTube and receives the app's initialization scripts and theme integration.
5. The configured theme is applied, extensions are reconciled with the live YouTube WebView, and a background watcher checks a user-selected extension folder for changes.

The main window's close handler saves its restore size and cleans up picture-in-picture state. It does not cancel the close request. However, startup also creates separate, hidden native windows for the menu and sign-in surfaces. Their lifecycle is not tied to closing the main window, so the native process may remain alive after the main window closes. This is a lifecycle issue to address if closing the main window is intended to quit the app. During development, `npm run tauri:dev` also owns the Vite server and Rust file watcher, so its terminal session remains active until stopped with `Ctrl+C`, even after the app exits.

## Source map

```text
src-tauri/
  capabilities/       Tauri permissions for app and YouTube webviews
  src/
    commands/         IPC commands exposed to the frontend
    core/             Shared state, paths, errors, and events
    extensions/       Extension discovery, validation, and runtime sync
    history/          SQLite history and migrations
    player/           Playback state and progress tracking
    rpc/              Discord Rich Presence integration
    settings/         Settings model and persistence
    theme/            Theme resolution, tokens, and native/web styling
    window/           Native windows, WebViews, tray, layout, and popups
  tauri.conf.json     Tauri identifiers, build commands, and bundling config
src/
  app/                Frontend bootstrap, routing, shell, and navigation
  auth-modal/         Sign-in surface
  components/         Shared UI components
  i18n/               Locales and translation helpers
  lib/                Frontend-to-Rust API wrapper
  menu/               Native app menu surface
  pages/              Launcher pages and settings screens
  pip/                Picture-in-picture frontend
  styles/             Base, component, page, and PiP styles
  theme/              Frontend theme provider
injected/             Scripts initialized in the YouTube WebView
public/               Static assets copied by Vite (including bundled fonts)
assets/               Branding and native app artwork
media/                Extension-related image assets
extensions/            User extension folder guidance; installed extensions are local
spikes/test-extension/ Sample browser extension used for development
docs/                  Project map and configuration reference
.github/               GitHub repository metadata
.vscode/               Editor extension recommendations
*.html                 Separate Tauri frontend entry points
package.json           npm commands and frontend dependencies
package-lock.json      Reproducible npm dependency versions
vite.config.ts         Vite and SolidJS integration
tsconfig.json          TypeScript compiler settings
.editorconfig          Shared editor formatting defaults
.gitattributes         Git text and line-ending rules
.gitignore             Build outputs, local data, and editor artifacts
```

## Frontend and native boundary

The frontend calls registered Tauri commands through `src/lib/api.ts`. Rust command handlers under `src-tauri/src/commands/` validate or coordinate requests and delegate domain work to the corresponding module. Tauri capabilities in `src-tauri/capabilities/` define which app or YouTube WebViews can call privileged APIs.

YouTube-specific CSS and behavior live in `injected/` and are installed when the YouTube WebView is created or rebuilt. The launcher UI is a separate WebView; its page styles are bundled with the frontend. This separation keeps YouTube page customization distinct from launcher styling and native window controls.

## Persistent data

`src-tauri/src/core/paths.rs` resolves and creates application-owned directories:

- `settings.json` in the app config directory
- `history.db`, thumbnails, extensions, and WebView profiles in the app data directory
- Separate WebView2 profile folders for the launcher/UI and YouTube surfaces, including their cookies and site storage

The app identifier is `com.ytdesktop.client`. These runtime files belong to the user's profile and should not be committed to Git.

## Main project files

- `package.json`: frontend and Tauri development/build commands
- `vite.config.ts` and `tsconfig.json`: frontend build and TypeScript settings
- `src-tauri/Cargo.toml`: native dependencies and Rust package metadata
- `src-tauri/tauri.conf.json`: Tauri build and bundle configuration
- `index.html`, `menu.html`, `pip.html`, `auth-modal.html`: frontend entry points

### Local data

Under `%APPDATA%\com.ytdesktop.client\`:

- `settings.json` — app preferences.
- `history.db` — SQLite history.
- `extensions/` — installed extensions.
- `thumbnails/` — thumbnails kept locally.
- `webview/` — one WebView2 user data folder per webview (`ui` and `yt`).

Local folders such as `backups/`, `backup_before_*/`, `planning/`, build output, and installed extensions are intentionally excluded from Git.
