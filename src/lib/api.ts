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
  hideScrollbars: boolean;
}

export type RpcTabMode = "smart" | "activeTabOnly" | "primaryPlaying";

export interface RpcSettings {
  enabled: boolean;
  appId: string;
  musicAppId: string;
  showVideoButton: boolean;
  showChannelButton: boolean;
  showTimestamps: boolean;
  idleWhenPaused: boolean;
  tabMode?: RpcTabMode;
}

export interface HistorySettings {
  enabled: boolean;
  minimumWatchSecs: number;
  keepThumbnails: boolean;
}

export interface ExtensionSettings {
  disabled: string[];
}

export type TitlebarStyle = "tabs" | "icons" | "compact";

export interface GeneralSettings {
  language: string;
  hardwareAcceleration: boolean;
  titlebarStyle: TitlebarStyle;
  minimizeToTray: boolean;
  pipOnMinimize: boolean;
  pipOnBlur: boolean;
  integrateMasthead: boolean;
  openLastPage: boolean;
  lastYoutubeUrl: string | null;
}

export interface AuthSnapshot {
  loggedIn: boolean;
  avatarUrl?: string | null;
  displayName?: string | null;
  handle?: string | null;
}

export interface YoutubeTitlebarIcons {
  search?: string;
  voice?: string;
  clear?: string;
  guide?: string;
  account?: string;
  history?: string;
}

export interface BrowserHistoryImportResult {
  browserName: string;
  imported: number;
}

export interface BrowserDataSource {
  id: string;
  name: string;
  isDefault: boolean;
  hasYoutubeHistory: boolean;
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

export type TabLayout = "command" | "bottom" | "floating" | "sidebar" | "sidebarHover";

export interface TabSettings {
  enabled: boolean;
  layout: TabLayout;
  sidebarExpanded: boolean;
  sidebarWidth: number;
  autoSleepMinutes: number;
  confirmCloseWithMultiple: boolean;
  defaultIsolated: boolean;
}

export interface TabState {
  id: string;
  webviewLabel: string;
  isolated: boolean;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  accountName: string | null;
  accountHandle: string | null;
  avatarUrl: string | null;
  pinned: boolean;
  muted: boolean;
  sleeping: boolean;
  needsReload: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPlaying: boolean;
  lastActiveAt: number;
}

export interface TabSessionSnapshot {
  tabs: TabState[];
  activeTabId: string;
}

export interface UpdateSettings {
  autoCheck: boolean;
  includePrerelease: boolean;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseUrl: string;
  downloadUrl: string | null;
  publishedAt: string | null;
  isPrerelease: boolean;
  updateAvailable: boolean;
  checkedAt: number;
}

export interface AppSettings {
  settingsVersion: number;
  window: WindowSettings;
  pip: PipSettings;
  theme: ThemeSettings;
  rpc: RpcSettings;
  history: HistorySettings;
  extensions: ExtensionSettings;
  general: GeneralSettings;
  tabs: TabSettings;
  updates: UpdateSettings;
}

export interface ResolvedTheme {
  themeId: string;
  name: string;
  mode: ThemeMode;
  effectiveMode: "light" | "dark";
  backdrop: Backdrop;
  accent: string;
  motion: boolean;
  hideScrollbars: boolean;
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
  positionSecs: number | null;
  watchedSecs: number | null;
  lastWatchedAt: number;
  watchCount: number;
}

export interface HistoryQuery {
  search: string;
  limit: number;
  offset: number;
  profileId?: string;
}

export interface RpcStatus {
  state: string;
  detail: string | null;
}

export interface YoutubeNavState {
  canGoBack: boolean;
  canGoForward: boolean;
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

  setLauncherRouteActive: (active: boolean): Promise<void> =>
    invoke<void>("set_launcher_route_active", { active }),

  ytNavigate: (action: NavigationAction): Promise<void> =>
    invoke<void>("yt_navigate", { action }),

  youtubeLoadingState: (): Promise<boolean> => invoke<boolean>("youtube_loading_state"),

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

  extensionsRefresh: (): Promise<ExtensionSummary[]> =>
    invoke<ExtensionSummary[]>("extensions_refresh"),

  extensionsInstall: (source: string): Promise<ExtensionSummary[]> =>
    invoke<ExtensionSummary[]>("extensions_install", { source }),

  extensionsUninstall: (id: string): Promise<void> =>
    invoke<void>("extensions_uninstall", { id }),

  extensionsSetEnabled: (id: string, enabled: boolean): Promise<ExtensionSummary[]> =>
    invoke<ExtensionSummary[]>("extensions_set_enabled", { id, enabled }),

  rpcStatus: (): Promise<RpcStatus> => invoke<RpcStatus>("rpc_status"),

  historyList: (query: HistoryQuery): Promise<HistoryEntry[]> =>
    invoke<HistoryEntry[]>("history_list", { query }),

  historyClear: (profileId?: string): Promise<void> =>
    invoke<void>("history_clear", { profileId }),

  historyDelete: (id: string, profileId?: string): Promise<void> =>
    invoke<void>("history_delete", { id, profileId }),

  tabsSnapshot: (): Promise<TabSessionSnapshot> =>
    invoke<TabSessionSnapshot>("tabs_snapshot"),

  tabCreate: (args?: { isolated?: boolean; url?: string; activate?: boolean }): Promise<TabSessionSnapshot> =>
    invoke<TabSessionSnapshot>("tab_create", args ?? {}),

  tabActivate: (tabId: string): Promise<TabSessionSnapshot> =>
    invoke<TabSessionSnapshot>("tab_activate", { tabId }),

  tabClose: (tabId: string): Promise<TabSessionSnapshot> =>
    invoke<TabSessionSnapshot>("tab_close", { tabId }),

  tabCloseOthers: (tabId: string): Promise<TabSessionSnapshot> =>
    invoke<TabSessionSnapshot>("tab_close_others", { tabId }),

  tabReopenClosed: (): Promise<TabSessionSnapshot> =>
    invoke<TabSessionSnapshot>("tab_reopen_closed"),

  tabReorder: (orderedIds: string[]): Promise<TabSessionSnapshot> =>
    invoke<TabSessionSnapshot>("tab_reorder", { orderedIds }),

  tabSetPinned: (tabId: string, pinned: boolean): Promise<TabSessionSnapshot> =>
    invoke<TabSessionSnapshot>("tab_set_pinned", { tabId, pinned }),

  tabSetMuted: (tabId: string, muted: boolean): Promise<TabSessionSnapshot> =>
    invoke<TabSessionSnapshot>("tab_set_muted", { tabId, muted }),

  tabDuplicate: (tabId: string, isolated?: boolean): Promise<TabSessionSnapshot> =>
    invoke<TabSessionSnapshot>("tab_duplicate", { tabId, isolated }),

  tabSleep: (tabId: string): Promise<TabSessionSnapshot> =>
    invoke<TabSessionSnapshot>("tab_sleep", { tabId }),

  tabSidebarPeek: (peek: boolean): Promise<void> =>
    invoke<void>("tab_sidebar_peek", { peek }),

  tabDockPeek: (peek: boolean): Promise<void> =>
    invoke<void>("tab_dock_peek", { peek }),

  setSidebarWidth: (width: number, expanded?: boolean, persist?: boolean): Promise<void> =>
    invoke<void>("set_sidebar_width", { width, expanded, persist }),

  tabOpenActionMenu: (): Promise<void> =>
    invoke<void>("tab_open_action_menu"),

  updatesCheck: (includePrerelease?: boolean): Promise<UpdateCheckResult> =>
    invoke<UpdateCheckResult>("updates_check", { includePrerelease }),

  updatesLastStatus: (): Promise<UpdateCheckResult | null> =>
    invoke<UpdateCheckResult | null>("updates_last_status"),

  updatesOpenUrl: (url: string): Promise<void> =>
    invoke<void>("updates_open_url", { url }),

  tabsClearIsolatedData: (): Promise<number> =>
    invoke<number>("tabs_clear_isolated_data"),

  setTabDockWidth: (width: number): Promise<void> =>
    invoke<void>("set_tab_dock_width", { width }),

  tabOpenContextMenu: (tabId: string, x: number, y: number): Promise<void> =>
    invoke<void>("tab_open_context_menu", { tabId, x, y }),

  browserDataSources: (): Promise<BrowserDataSource[]> =>
    invoke<BrowserDataSource[]>("browser_data_sources"),

  browserHistoryImport: (browserId: string): Promise<BrowserHistoryImportResult> =>
    invoke<BrowserHistoryImportResult>("browser_history_import", { browserId }),

  openRepository: (): Promise<void> => invoke<void>("open_repository"),

  setMastheadIntegrated: (integrated: boolean): Promise<void> =>
    invoke<void>("set_masthead_integrated", { integrated }),

  requestAuthSnapshot: (): Promise<void> => invoke<void>("request_auth_snapshot"),

  requestYoutubeTitlebarIcons: (): Promise<void> =>
    invoke<void>("request_youtube_titlebar_icons"),

  requestYoutubeNavState: (): Promise<void> =>
    invoke<void>("request_youtube_nav_state"),

  setUiElevation: (elevated: boolean): Promise<void> =>
    invoke<void>("set_ui_elevation", { elevated }),

  fetchSuggestions: (query: string): Promise<string[]> =>
    invoke<string[]>("yt_suggest", { query }),

  openAuthModal: (): Promise<void> => invoke<void>("open_auth_modal"),

  closeAuthModal: (): Promise<void> => invoke<void>("close_auth_modal"),

  reloadAuthModal: (): Promise<void> => invoke<void>("reload_auth_modal"),

  backAuthModal: (): Promise<void> => invoke<void>("back_auth_modal"),

  isAuthModalVisible: (): Promise<boolean> => invoke<boolean>("is_auth_modal_visible"),
};
