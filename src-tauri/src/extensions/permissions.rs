use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// Permissions declared by an extension in `ytapp.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Permission {
    #[serde(rename = "player.read")]
    PlayerRead,
    #[serde(rename = "player.control")]
    PlayerControl,
    #[serde(rename = "history.read")]
    HistoryRead,
    #[serde(rename = "history.write")]
    HistoryWrite,
    #[serde(rename = "rpc.read")]
    RpcRead,
    #[serde(rename = "rpc.write")]
    RpcWrite,
    #[serde(rename = "titlebar.buttons")]
    TitlebarButtons,
    #[serde(rename = "storage")]
    Storage,
    #[serde(rename = "theme.read")]
    ThemeRead,
    #[serde(rename = "theme.write")]
    ThemeWrite,
}

impl Permission {
    pub const ALL: &'static [Permission] = &[
        Permission::PlayerRead,
        Permission::PlayerControl,
        Permission::HistoryRead,
        Permission::HistoryWrite,
        Permission::RpcRead,
        Permission::RpcWrite,
        Permission::TitlebarButtons,
        Permission::Storage,
        Permission::ThemeRead,
        Permission::ThemeWrite,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Permission::PlayerRead => "player.read",
            Permission::PlayerControl => "player.control",
            Permission::HistoryRead => "history.read",
            Permission::HistoryWrite => "history.write",
            Permission::RpcRead => "rpc.read",
            Permission::RpcWrite => "rpc.write",
            Permission::TitlebarButtons => "titlebar.buttons",
            Permission::Storage => "storage",
            Permission::ThemeRead => "theme.read",
            Permission::ThemeWrite => "theme.write",
        }
    }
}

impl fmt::Display for Permission {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for Permission {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .iter()
            .copied()
            .find(|permission| permission.as_str() == value)
            .ok_or_else(|| format!("unknown permission: {value}"))
    }
}
