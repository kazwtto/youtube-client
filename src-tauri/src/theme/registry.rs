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
    name: "Default",
    description: "The standard look, over the Windows material.",
    light: Palette {
        bg: "rgba(255, 255, 255, 0.72)",
        bg_elevated: "#ffffff",
        bg_solid: "#ffffff",
        fg: "#0f0f0f",
        fg_muted: "#606060",
        border: "rgba(0, 0, 0, 0.1)",
        hover: "rgba(0, 0, 0, 0.05)",
        pressed: "rgba(0, 0, 0, 0.1)",
        danger: "#cc0000",
        success: "#1a7f37",
        warning: "#a05a00",
    },
    dark: Palette {
        bg: "rgba(15, 15, 15, 0.62)",
        bg_elevated: "#212121",
        bg_solid: "#0f0f0f",
        fg: "#f1f1f1",
        fg_muted: "#aaaaaa",
        border: "rgba(255, 255, 255, 0.12)",
        hover: "rgba(255, 255, 255, 0.1)",
        pressed: "rgba(255, 255, 255, 0.16)",
        danger: "#ff4e45",
        success: "#2ba640",
        warning: "#fdd663",
    },
};

pub const HIGH_CONTRAST: ThemeDefinition = ThemeDefinition {
    id: "high-contrast",
    name: "High contrast",
    description: "Strongest contrast, for easier reading.",
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
