use std::collections::BTreeMap;

use super::model::ThemeSettings;
use super::registry::Palette;

/// Builds CSS tokens from the palette and user preferences.
pub fn build(
    palette: &Palette,
    settings: &ThemeSettings,
    effective_dark: bool,
) -> BTreeMap<String, String> {
    let mut tokens = BTreeMap::new();

    tokens.insert("--color-bg".into(), palette.bg.into());
    tokens.insert("--color-bg-elevated".into(), palette.bg_elevated.into());
    tokens.insert("--color-bg-solid".into(), palette.bg_solid.into());
    tokens.insert("--color-fg".into(), palette.fg.into());
    tokens.insert("--color-fg-muted".into(), palette.fg_muted.into());
    tokens.insert("--color-border".into(), palette.border.into());
    tokens.insert("--color-hover".into(), palette.hover.into());
    tokens.insert("--color-pressed".into(), palette.pressed.into());
    tokens.insert("--color-danger".into(), palette.danger.into());
    tokens.insert("--color-success".into(), palette.success.into());
    tokens.insert("--color-warning".into(), palette.warning.into());

    tokens.insert("--color-accent".into(), settings.accent.clone());
    tokens.insert(
        "--color-accent-fg".into(),
        accent_foreground(&settings.accent).into(),
    );

    let radius = settings.radius.clamp(2, 24);
    tokens.insert(
        "--radius-sm".into(),
        format!("{}px", radius.saturating_sub(2)),
    );
    tokens.insert("--radius-md".into(), format!("{radius}px"));
    tokens.insert("--radius-lg".into(), format!("{}px", radius + 4));

    let motion = if settings.motion { "140ms" } else { "0ms" };
    tokens.insert("--motion-fast".into(), motion.into());
    tokens.insert("--motion-normal".into(), motion.into());

    tokens.insert(
        "--font-family".into(),
        "\"Segoe UI Variable Text\", \"Segoe UI\", system-ui, sans-serif".into(),
    );
    tokens.insert("--font-size-base".into(), "14px".into());
    tokens.insert(
        "--color-scheme".into(),
        if effective_dark { "dark" } else { "light" }.into(),
    );

    tokens
}

/// Chooses black or white as the text color over the accent color.
fn accent_foreground(hex: &str) -> &'static str {
    let Some((r, g, b)) = parse_hex(hex) else {
        return "#ffffff";
    };

    let luminance = (0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64) / 255.0;
    if luminance > 0.6 {
        "#000000"
    } else {
        "#ffffff"
    }
}

fn parse_hex(hex: &str) -> Option<(u8, u8, u8)> {
    let value = hex.strip_prefix('#')?;
    if value.len() != 6 || !value.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }

    let r = u8::from_str_radix(&value[0..2], 16).ok()?;
    let g = u8::from_str_radix(&value[2..4], 16).ok()?;
    let b = u8::from_str_radix(&value[4..6], 16).ok()?;
    Some((r, g, b))
}
