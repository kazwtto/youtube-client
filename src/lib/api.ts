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

export interface GeneralSettings {
  language: string;
  hardwareAcceleration: boolean;
}

export interface AppSettings {
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

export type NavigationAction = "back" | "forward" | "home" | "reload";

export const api = {
  appVersion: (): Promise<string> => invoke<string>("app_version"),

  setWebviewVisible: (label: string, visible: boolean): Promise<void> =>
    invoke<void>("set_webview_visible", { label, visible }),

  ytNavigate: (action: NavigationAction): Promise<void> =>
    invoke<void>("yt_navigate", { action }),

  themeList: (): Promise<ThemeSummary[]> => invoke<ThemeSummary[]>("theme_list"),

  themeGet: (): Promise<ResolvedTheme> => invoke<ResolvedTheme>("theme_get"),

  settingsGet: (): Promise<AppSettings> => invoke<AppSettings>("settings_get"),

  settingsUpdate: (settings: AppSettings): Promise<AppSettings> =>
    invoke<AppSettings>("settings_update", { settings }),

  extensionsList: (): Promise<ExtensionSummary[]> =>
    invoke<ExtensionSummary[]>("extensions_list"),

  extensionsInstall: (source: string): Promise<ExtensionSummary> =>
    invoke<ExtensionSummary>("extensions_install", { source }),

  extensionsUninstall: (id: string): Promise<void> =>
    invoke<void>("extensions_uninstall", { id }),

  extensionsSetEnabled: (id: string, enabled: boolean): Promise<ExtensionSummary[]> =>
    invoke<ExtensionSummary[]>("extensions_set_enabled", { id, enabled }),

  rpcStatus: (): Promise<RpcStatus> => invoke<RpcStatus>("rpc_status"),

  historyList: (query: HistoryQuery): Promise<HistoryEntry[]> =>
    invoke<HistoryEntry[]>("history_list", { query }),

  historyClear: (): Promise<void> => invoke<void>("history_clear"),

  historyDelete: (id: string): Promise<void> => invoke<void>("history_delete", { id }),
};