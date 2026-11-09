# Default settings

These are the defaults from the Rust settings model. A first launch starts with these values; saved user settings take precedence on later launches.

| Area | Default |
| --- | --- |
| Window | 1280 × 800 logical pixels; not maximized |
| Picture-in-picture | Enabled; native mode; 480 × 270; position chosen automatically |
| Theme | Fluent; follow system light/dark mode; solid backdrop; accent `#ff0033`; radius 8 px; motion enabled; scrollbars visible |
| Discord Rich Presence | Disabled; video/channel buttons and timestamps enabled; clear presence while paused |
| Playback history | Enabled; record after 5 seconds watched; keep thumbnails |
| Extensions | Enabled unless individually disabled; no custom scan folder |
| Language | English (`en`) |
| Hardware acceleration | Enabled |
| Title bar | Icons |
| Minimize to tray | Disabled |
| Open PiP on minimize | Enabled |
| Open PiP on losing focus | Disabled |
| Client integration (hide YouTube masthead) | Disabled |
| Reopen last YouTube page | Enabled, but the first launch has no saved URL |

The defaults are defined in `src-tauri/src/settings/model.rs`, `src-tauri/src/theme/model.rs`, and `src-tauri/src/rpc/model.rs`. They are serialized in camelCase to the app's `settings.json` file.

The Tauri bundle identifier is `com.ytdesktop.client`. The native window and WebViews are created in Rust, so `tauri.conf.json` has an empty declarative `windows` list; the effective initial window size comes from the settings defaults above.
