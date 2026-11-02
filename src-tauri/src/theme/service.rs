use tauri::{Manager, Theme};

use crate::core::error::{AppError, AppResult};

use super::model::{Backdrop, ResolvedTheme, ThemeMode, ThemeSettings};
use super::{registry, tokens};

/// Resolves, applies, and synchronizes the theme on the window and the YouTube webview.
pub struct ThemeService;

impl ThemeService {
    pub fn resolve(settings: &ThemeSettings, system_dark: bool) -> AppResult<ResolvedTheme> {
        let definition = registry::find(&settings.theme_id)
            .ok_or_else(|| AppError::Validation(format!("unknown theme: {}", settings.theme_id)))?;

        validate_hex(&settings.accent)?;

        let effective_dark = match settings.mode {
            ThemeMode::Light => false,
            ThemeMode::Dark => true,
            ThemeMode::System => system_dark,
        };

        let palette = if effective_dark {
            &definition.dark
        } else {
            &definition.light
        };

        // High contrast is defined by solid black/white surfaces; a translucent
        // material behind the window would reduce the contrast it promises.
        let mut effective = settings.clone();
        if definition.id == "high-contrast" {
            effective.backdrop = Backdrop::Solid;
        }

        Ok(ResolvedTheme {
            theme_id: definition.id.to_string(),
            name: definition.name.to_string(),
            mode: settings.mode,
            effective_mode: if effective_dark {
                ThemeMode::Dark
            } else {
                ThemeMode::Light
            },
            backdrop: effective.backdrop,
            accent: settings.accent.clone(),
            tokens: tokens::build(palette, &effective, effective_dark),
        })
    }

    /// Applies the theme to the native window (Mica/Acrylic and light/dark mode).
    pub fn apply_to_window(window: &tauri::Window, resolved: &ResolvedTheme) -> AppResult<()> {
        let dark = resolved.effective_mode == ThemeMode::Dark;

        window.set_theme(Some(if dark { Theme::Dark } else { Theme::Light }))?;

        #[cfg(windows)]
        {
            use window_vibrancy::{apply_acrylic, apply_mica, clear_acrylic, clear_mica};

            // Applying a material can change the window frame on some Windows
            // builds, which visibly grows the window. Restore the client size
            // afterwards if the compositor changed it.
            let size_before = window.inner_size().ok();
            let resizable = !window.is_maximized().unwrap_or(false)
                && !window.is_fullscreen().unwrap_or(false);

            match resolved.backdrop {
                Backdrop::Mica => {
                    let _ = clear_acrylic(window);
                    if apply_mica(window, Some(dark)).is_err() {
                        // Fallback gracefully on Windows builds without Mica support
                        let _ = clear_mica(window);
                    }
                }
                Backdrop::Acrylic => {
                    let _ = clear_mica(window);
                    if apply_acrylic(window, None).is_err() {
                        // Fallback gracefully on Windows builds without Acrylic support
                        let _ = clear_acrylic(window);
                    }
                }
                Backdrop::Solid => {
                    let _ = clear_mica(window);
                    let _ = clear_acrylic(window);
                }
            }

            if resizable {
                if let Some(before) = size_before {
                    if window.inner_size().map(|now| now != before).unwrap_or(false) {
                        let _ = window.set_size(tauri::Size::Physical(before));
                    }
                }
            }
        }

        Ok(())
    }

    /// Pushes the resolved theme into the YouTube webview.
    ///
    /// The webview defines `window.__ytdesktopApplyTheme` in an initialization
    /// script, so the same mapping runs on load and on every update.
    pub fn apply_to_youtube(window: &tauri::Window, resolved: &ResolvedTheme) -> AppResult<()> {
        let Some(webview) = window.get_webview("yt") else {
            return Ok(());
        };

        let payload = serde_json::to_string(resolved)?;
        let script =
            format!("window.__ytdesktopApplyTheme && window.__ytdesktopApplyTheme({payload});");

        webview.eval(&script).map_err(AppError::from)?;
        Ok(())
    }
}

fn validate_hex(value: &str) -> AppResult<()> {
    let trimmed = value.trim();
    let valid = trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed[1..].chars().all(|c| c.is_ascii_hexdigit());

    if valid {
        Ok(())
    } else {
        Err(AppError::Validation(format!("invalid color: {value}")))
    }
}
