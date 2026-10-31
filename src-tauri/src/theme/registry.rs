use super::model::ThemeSummary;

/// Color palette for a theme in a mode (light or dark).
pub struct Palette {
    pub bg: &'static str,
    pub bg_elevated: &'static str,
    pub bg_solid: &'static str,
    pub fg: &'static str,
    pub fg_muted: &'static str,
    pub border: &'static str,
    pub hover: &'static str,
    pub pressed: &'static str,
    pub danger: &'static str,
    pub success: &'static str,
    pub warning: &'static str,
}

/// Complete theme definition.
pub struct ThemeDefinition {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub light: Palette,
    pub dark: Palette,
}

pub const FLUENT: ThemeDefinition = ThemeDefinition {
    id: "fluent",
    name: "Fluent",
    description: "Windows 11 default, with Mica and Segoe UI Variable typography.",
    light: Palette {
        bg: "rgba(243, 243, 243, 0.86)",
        bg_elevated: "#ffffff",
        bg_solid: "#f3f3f3",
        fg: "#1b1b1b",
        fg_muted: "#5c5c5c",
        border: "rgba(0, 0, 0, 0.08)",
        hover: "rgba(0, 0, 0, 0.06)",
        pressed: "rgba(0, 0, 0, 0.12)",
        danger: "#c42b1c",
        success: "#0f7b0f",
        warning: "#9d5d00",
    },
    dark: Palette {
        bg: "rgba(32, 32, 32, 0.86)",
        bg_elevated: "#2b2b2b",
        bg_solid: "#202020",
        fg: "#f5f5f5",
        fg_muted: "#a0a0a0",
        border: "rgba(255, 255, 255, 0.08)",
        hover: "rgba(255, 255, 255, 0.08)",
        pressed: "rgba(255, 255, 255, 0.14)",
        danger: "#ff99a4",
        success: "#6ccb5f",
        warning: "#fce100",
    },
};

pub const HIGH_CONTRAST: ThemeDefinition = ThemeDefinition {
    id: "high-contrast",
    name: "High contrast",
    description: "Maximum contrast for accessibility.",
    light: Palette {
        bg: "#ffffff",
        bg_elevated: "#ffffff",
        bg_solid: "#ffffff",
        fg: "#000000",
        fg_muted: "#000000",
        border: "#000000",
        hover: "#e5e5e5",
        pressed: "#cccccc",
        danger: "#b00020",
        success: "#006400",
        warning: "#7a4f00",
    },
    dark: Palette {
        bg: "#000000",
        bg_elevated: "#000000",
        bg_solid: "#000000",
        fg: "#ffffff",
        fg_muted: "#ffffff",
        border: "#ffffff",
        hover: "#1f1f1f",
        pressed: "#333333",
        danger: "#ff8080",
        success: "#7dff7d",
        warning: "#ffff80",
    },
};

pub fn all() -> &'static [ThemeDefinition] {
    &[FLUENT, HIGH_CONTRAST]
}

pub fn find(id: &str) -> Option<&'static ThemeDefinition> {
    all().iter().find(|theme| theme.id == id)
}

pub fn summaries() -> Vec<ThemeSummary> {
    all()
        .iter()
        .map(|theme| ThemeSummary {
            id: theme.id.to_string(),
            name: theme.name.to_string(),
            description: theme.description.to_string(),
        })
        .collect()
}
