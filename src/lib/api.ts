import { invoke } from "@tauri-apps/api/core";

export type ThemeMode = "system" | "light" | "dark";
export type Backdrop = "mica" | "acrylic" | "solid";

export interface ThemeSettings {
  themeId: string;
  mode: ThemeMode;
  backdrop: Backdrop;
  accent: string;
  radius: number;
  motion: boolean;
}

export interface RpcSettings {
  enabled: boolean;
  appId: string;
  musicAppId: string;
  showVideoButton: boolean;
  showChannelButton: boolean;
  showTimestamps: boolean;
  idleWhenPaused: boolean;
}

export interface HistorySettings {
  enabled: boolean;
  minimumWatchSecs: number;
  keepThumbnails: boolean;
}

export interface ExtensionSettings {
  disabled: string[];
}

export type TitlebarStyle = "tabs" | "icons";

export interface GeneralSettings {
  language: string;
  hardwareAcceleration: boolean;
  titlebarStyle: TitlebarStyle;
  pipOnMinimize: boolean;
  pipOnBlur: boolean;
  integrateMasthead: boolean;
}

export interface AuthSnapshot {
  loggedIn: boolean;
  avatarUrl?: string | null;
  displayName?: string | null;
  handle?: string | null;
}

export interface WindowSettings {
  width: number;
  height: number;
  maximized: boolean;
}

export type PipMode = "custom" | "native";

export interface PipSettings {
  enabled: boolean;
  mode: PipMode;
  width: number;
  height: number;
  x?: number | null;
  y?: number | null;
}

export interface AppSettings {
  window: WindowSettings;
  pip: PipSettings;
  theme: ThemeSettings;
  rpc: RpcSettings;
  history: HistorySettings;
  extensions: ExtensionSettings;
  general: GeneralSettings;
}

export interface ResolvedTheme {
  themeId: string;
  name: string;
  mode: ThemeMode;
  effectiveMode: "light" | "dark";
  backdrop: Backdrop;
  accent: string;
  motion: boolean;
  tokens: Record<string, string>;
}

export interface ThemeSummary {
  id: string;
  name: string;
  description: string;
}

export interface ExtensionSummary {
  id: string;
  name: string;
  version: string;
  description: string | null;
  permissions: string[];
  enabled: boolean;
  hasChromiumManifest: boolean;
  hasYtappManifest: boolean;
  path: string;
}

export interface HistoryEntry {
  id: string;
  title: string;
  channel: string;
  durationSecs: number | null;
  thumbnailPath: string | null;
  lastWatchedAt: number;
  watchCount: number;
}

export interface HistoryQuery {
  search: string;
  limit: number;
  offset: number;
}

export interface RpcStatus {
  state: string;
  detail: string | null;
}

export type NavigationAction =
  | "back"
  | "forward"
  | "home"
  | "reload"
  | "guide"
  | "avatar"
  | "voice"
  | `search:${string}`
  | `url:${string}`
  | `eval:${string}`;

export const api = {
  appVersion: (): Promise<string> => invoke<string>("app_version"),

  setWebviewVisible: (label: string, visible: boolean): Promise<void> =>
    invoke<void>("set_webview_visible", { label, visible }),

  ytNavigate: (action: NavigationAction): Promise<void> =>
    invoke<void>("yt_navigate", { action }),

  ytPlayVideo: (videoId: string): Promise<void> =>
    invoke<void>("yt_play_video", { videoId }),

  pipOpen: (): Promise<void> => invoke<void>("pip_open"),

  pipClose: (): Promise<void> => invoke<void>("pip_close"),

  themeList: (): Promise<ThemeSummary[]> => invoke<ThemeSummary[]>("theme_list"),

  themeGet: (): Promise<ResolvedTheme> => invoke<ResolvedTheme>("theme_get"),

  settingsGet: (): Promise<AppSettings> => invoke<AppSettings>("settings_get"),

  settingsUpdate: (settings: AppSettings): Promise<AppSettings> =>
    invoke<AppSettings>("settings_update", { settings }),

  extensionsList: (): Promise<ExtensionSummary[]> =>
    invoke<ExtensionSummary[]>("extensions_list"),

  extensionsInstall: (source: string): Promise<ExtensionSummary[]> =>
    invoke<ExtensionSummary[]>("extensions_install", { source }),

  extensionsUninstall: (id: string): Promise<void> =>
    invoke<void>("extensions_uninstall", { id }),

  extensionsSetEnabled: (id: string, enabled: boolean): Promise<ExtensionSummary[]> =>
    invoke<ExtensionSummary[]>("extensions_set_enabled", { id, enabled }),

  rpcStatus: (): Promise<RpcStatus> => invoke<RpcStatus>("rpc_status"),

  historyList: (query: HistoryQuery): Promise<HistoryEntry[]> =>
    invoke<HistoryEntry[]>("history_list", { query }),

  historyClear: (): Promise<void> => invoke<void>("history_clear"),

  historyDelete: (id: string): Promise<void> => invoke<void>("history_delete", { id }),

  setMastheadIntegrated: (integrated: boolean): Promise<void> =>
    invoke<void>("set_masthead_integrated", { integrated }),

  setUiElevation: (elevated: boolean): Promise<void> =>
    invoke<void>("set_ui_elevation", { elevated }),

  fetchSuggestions: (query: string): Promise<string[]> =>
    invoke<string[]>("yt_suggest", { query }),

  showContextMenu: (args: {
    x: number;
    y: number;
    width?: number;
    height?: number;
    auth: AuthSnapshot;
  }): Promise<void> => invoke<void>("show_context_menu", { args }),

  hideContextMenu: (): Promise<void> => invoke<void>("hide_context_menu"),

  isContextMenuVisible: (): Promise<boolean> => invoke<boolean>("is_context_menu_visible"),

  openAuthModal: (): Promise<void> => invoke<void>("open_auth_modal"),

  closeAuthModal: (): Promise<void> => invoke<void>("close_auth_modal"),

  reloadAuthModal: (): Promise<void> => invoke<void>("reload_auth_modal"),

  backAuthModal: (): Promise<void> => invoke<void>("back_auth_modal"),

  isAuthModalVisible: (): Promise<boolean> => invoke<boolean>("is_auth_modal_visible"),
};
