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

        Ok(ResolvedTheme {
            theme_id: definition.id.to_string(),
            name: definition.name.to_string(),
            mode: settings.mode,
            effective_mode: if effective_dark {
                ThemeMode::Dark
            } else {
                ThemeMode::Light
            },
            backdrop: settings.backdrop,
            accent: settings.accent.clone(),
            tokens: tokens::build(palette, settings, effective_dark),
        })
    }

    /// Applies the theme to the native window (Mica/Acrylic and light/dark mode).
    pub fn apply_to_window(window: &tauri::Window, resolved: &ResolvedTheme) -> AppResult<()> {
        let dark = resolved.effective_mode == ThemeMode::Dark;

        window.set_theme(Some(if dark { Theme::Dark } else { Theme::Light }))?;

        #[cfg(windows)]
        {
            use window_vibrancy::{apply_acrylic, apply_mica, clear_acrylic, clear_mica};

            match resolved.backdrop {
                Backdrop::Mica => {
                    let _ = clear_acrylic(window);
                    apply_mica(window, Some(dark))
                        .map_err(|error| AppError::Other(error.to_string()))?;
                }
                Backdrop::Acrylic => {
                    let _ = clear_mica(window);
                    apply_acrylic(window, None)
                        .map_err(|error| AppError::Other(error.to_string()))?;
                }
                Backdrop::Solid => {
                    let _ = clear_mica(window);
                    let _ = clear_acrylic(window);
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
