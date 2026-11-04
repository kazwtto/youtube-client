import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { RouteId } from "../app/router";
import { t, type TranslationKey } from "../i18n";
import { api, type AuthSnapshot, type RpcStatus, type TitlebarStyle } from "../lib/api";
import { Icon, type IconName } from "./icons";

export interface TitlebarActions {
  onNavigate: (id: RouteId) => void;
}

export interface Titlebar {
  element: HTMLElement;
  setActive: (id: RouteId) => void;
  setRpcStatus: (status: RpcStatus) => void;
  setStyle: (style: TitlebarStyle) => void;
  setMastheadIntegrated: (integrated: boolean) => void;
  setAuth: (auth: AuthSnapshot) => void;
}

interface Tab {
  id: RouteId;
  labelKey: TranslationKey;
  icon: IconName;
}

interface Suggestion {
  text: string;
  isHistory: boolean;
}

const TABS: readonly Tab[] = [
  { id: "home", labelKey: "nav.watch", icon: "home" },
  { id: "history", labelKey: "nav.history", icon: "history" },
  { id: "extensions", labelKey: "nav.extensions", icon: "extensions" },
  { id: "rpc", labelKey: "nav.discord", icon: "discord" },
  { id: "settings", labelKey: "nav.settings", icon: "settings" },
];

const SEARCH_HISTORY_KEY = "ytdesktop_search_history";

function getSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveSearchHistoryQuery(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  try {
    const current = getSearchHistory().filter((item) => item.toLowerCase() !== trimmed.toLowerCase());
    current.unshift(trimmed);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(current.slice(0, 15)));
  } catch {
    // Storage can be unavailable or full; search still works without history.
  }
}

function removeSearchHistoryQuery(query: string): void {
  try {
    localStorage.setItem(
      SEARCH_HISTORY_KEY,
      JSON.stringify(getSearchHistory().filter((item) => item.toLowerCase() !== query.toLowerCase())),
    );
  } catch {
    // Storage can be unavailable; leave the menu usable.
  }
}

interface TitlebarState {
  active: () => RouteId;
  setActive: (id: RouteId) => void;
  rpc: () => RpcStatus;
  setRpc: (status: RpcStatus) => void;
  style: () => TitlebarStyle;
  setStyle: (style: TitlebarStyle) => void;
  integrated: () => boolean;
  setIntegrated: (value: boolean) => void;
  auth: () => AuthSnapshot;
  setAuth: (value: AuthSnapshot) => void;
}

function TitlebarContent(props: { actions: TitlebarActions; bar: HTMLElement; state: TitlebarState }) {
  const { state } = props;
  const [query, setQuery] = createSignal("");
  const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [maximized, setMaximized] = createSignal(false);
  const [avatarFailed, setAvatarFailed] = createSignal(false);
  let searchContainer!: HTMLDivElement;
  let searchInput!: HTMLInputElement;
  let authContainer!: HTMLDivElement;
  let suggestTimer: number | undefined;
  let latestSuggestionRequest = 0;
  let lastMenuCloseTime = 0;
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];
  const appWindow = getCurrentWindow();

  createEffect(() => {
    state.auth().avatarUrl;
    setAvatarFailed(false);
  });

  const closeSuggestions = (): void => {
    latestSuggestionRequest += 1;
    if (suggestTimer !== undefined) {
      window.clearTimeout(suggestTimer);
      suggestTimer = undefined;
    }
    setSuggestions([]);
    setSelectedIndex(-1);
    void api.setUiElevation(false).catch(() => undefined);
  };

  const showSuggestions = (items: Suggestion[]): void => {
    setSuggestions(items);
    setSelectedIndex(-1);
    void api.setUiElevation(items.length > 0).catch(() => undefined);
  };

  const submitSearch = (raw: string): void => {
    const value = raw.trim();
    if (!value) return;
    saveSearchHistoryQuery(value);
    setQuery(value);
    closeSuggestions();
    props.actions.onNavigate("home");
    void api.ytNavigate(`search:${encodeURIComponent(value)}`);
  };

  const updateSearchDropdown = async (): Promise<void> => {
    const rawValue = searchInput.value;
    const normalized = rawValue.trim().toLowerCase();
    const history = getSearchHistory();
    const request = ++latestSuggestionRequest;
    if (!normalized) {
      showSuggestions(history.map((text) => ({ text, isHistory: true })));
      return;
    }

    const matchedHistory = history
      .filter((item) => item.toLowerCase().includes(normalized))
      .map((text) => ({ text, isHistory: true }));
    try {
      const remote = await api.fetchSuggestions(rawValue);
      if (request !== latestSuggestionRequest || document.activeElement !== searchInput || searchInput.value !== rawValue) return;
      const filtered = remote
        .filter((item) => !matchedHistory.some((historyItem) => historyItem.text.toLowerCase() === item.toLowerCase()))
        .map((text) => ({ text, isHistory: false }));
      showSuggestions([...matchedHistory, ...filtered]);
    } catch {
      if (request !== latestSuggestionRequest || document.activeElement !== searchInput || searchInput.value !== rawValue) return;
      showSuggestions(matchedHistory);
    }
  };

  const highlight = (index: number): void => {
    const items = suggestions();
    if (index < 0 || index >= items.length) return;
    setSelectedIndex(index);
    setQuery(items[index].text);
  };

  const toggleAuthMenu = async (): Promise<void> => {
    if (Date.now() - lastMenuCloseTime < 220) return;
    if (await api.isContextMenuVisible()) {
      await api.hideContextMenu();
      return;
    }

    const rect = authContainer.getBoundingClientRect();
    const outerPos = await appWindow.outerPosition();
    const scale = await appWindow.scaleFactor();
    const width = 260;
    const height = state.auth().loggedIn ? 430 : 230;
    const paddingX = 24;
    const topPadding = 8;
    const bottomPadding = 36;
    await api.showContextMenu({
      x: Math.round(outerPos.x / scale + rect.right - width - paddingX),
      y: Math.round(outerPos.y / scale + rect.bottom + 6 - topPadding),
      width: width + paddingX * 2,
      height: height + topPadding + bottomPadding,
      auth: state.auth(),
    });
  };

  const handleAction = async (action: string): Promise<void> => {
    switch (action) {
      case "back":
      case "forward":
      case "reload":
      case "guide":
      case "voice":
        await api.ytNavigate(action);
        break;
      case "toggle-auth-menu":
        await toggleAuthMenu();
        break;
      case "minimize":
        await appWindow.minimize();
        break;
      case "toggle-maximize":
        await appWindow.toggleMaximize();
        await syncMaximize();
        break;
      case "close":
        await appWindow.close();
        break;
    }
  };

  const runAction = (action: string): void => {
    void handleAction(action).catch(() => undefined);
  };

  async function syncMaximize(): Promise<void> {
    try {
      setMaximized(await appWindow.isMaximized());
    } catch {
      // The window can close while its state is being read.
    }
  }

  const onDocumentClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!searchContainer.contains(target)) closeSuggestions();
    if (!authContainer.contains(target)) void api.hideContextMenu().catch(() => undefined);
  };

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    void api.hideContextMenu().catch(() => undefined);
    if (suggestions().length > 0) closeSuggestions();
  };

  const onBarDoubleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button, [data-route], .titlebar__search-box")) return;
    runAction("toggle-maximize");
  };

  onMount(() => {
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onDocumentKeyDown);
    props.bar.addEventListener("dblclick", onBarDoubleClick);
    void syncMaximize();

    const register = (promise: Promise<UnlistenFn>): void => {
      void promise.then((stop) => {
        if (disposed) stop();
        else unlisteners.push(stop);
      }).catch(() => undefined);
    };
    register(appWindow.onResized(() => void syncMaximize()));
    register(listen("menu://closed", () => { lastMenuCloseTime = Date.now(); }));
    register(listen<{ action: string }>("menu-action", (event) => {
      const action = event.payload?.action;
      if (!action) return;
      if (action === "login") void api.openAuthModal();
      else if (action === "logout") {
        props.actions.onNavigate("home");
        void api.ytNavigate("url:https://www.youtube.com/logout");
      } else if (action === "channel") {
        props.actions.onNavigate("home");
        void api.ytNavigate("url:https://www.youtube.com/feed/library");
      } else if (action === "studio") {
        props.actions.onNavigate("home");
        void api.ytNavigate("url:https://studio.youtube.com");
      } else if (action === "purchases") {
        props.actions.onNavigate("home");
        void api.ytNavigate("url:https://www.youtube.com/paid_memberships");
      } else if (action === "your-data") {
        props.actions.onNavigate("home");
        void api.ytNavigate("url:https://myaccount.google.com/yourdata/youtube");
      } else if (action === "shortcuts") {
        props.actions.onNavigate("home");
        void api.ytNavigate("eval:(function(){ document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true })); })()");
      } else if (action === "settings-app") {
        props.actions.onNavigate("settings");
      } else if (action === "help") {
        props.actions.onNavigate("home");
        void api.ytNavigate("url:https://support.google.com/youtube");
      }
    }));

    onCleanup(() => {
      disposed = true;
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onDocumentKeyDown);
      props.bar.removeEventListener("dblclick", onBarDoubleClick);
      for (const stop of unlisteners) stop();
      if (suggestTimer !== undefined) window.clearTimeout(suggestTimer);
      void api.setUiElevation(false).catch(() => undefined);
    });
  });

  const renderTabButton = (tab: Tab, iconOnly = false) => (
    <button
      type="button"
      class={iconOnly ? "titlebar__button titlebar__button--app" : "titlebar__tab"}
      classList={{
        "titlebar__tab--active": !iconOnly && state.active() === tab.id,
        "titlebar__button--active": iconOnly && state.active() === tab.id,
      }}
      data-route={tab.id}
      title={tab.id === "rpc" ? rpcTitle() : t(tab.labelKey)}
      aria-label={iconOnly ? t(tab.labelKey) : undefined}
      aria-current={state.active() === tab.id ? "page" : undefined}
      onClick={() => props.actions.onNavigate(tab.id)}
    >
      <Show when={iconOnly} fallback={
        <>
          <Icon name={tab.icon} size={17} class="titlebar__tab-icon" />
          <span class="titlebar__tab-label">{t(tab.labelKey)}</span>
        </>
      }>
        <Icon name={tab.icon} size={17} />
      </Show>
      <Show when={tab.id === "rpc"}>
        <span class={iconOnly ? "titlebar__status" : "titlebar__dot"} data-rpc-state={state.rpc().state} aria-hidden="true" />
      </Show>
    </button>
  );

  const rpcTitle = (): string => {
    const status = state.rpc();
    const detail = status.state === "notConfigured"
      ? t("rpc.notConfiguredDetail")
      : status.state === "error" && status.detail
        ? t("rpc.errorDetail", { error: status.detail })
        : t((`rpc.state.${status.state}`) as TranslationKey);
    return `${t("nav.discord")} — ${detail}`;
  };

  const navigationButton = (action: string, label: TranslationKey, iconName: IconName, className = "") => (
    <button type="button" class={`titlebar__button ${className}`} data-action={action} title={t(label)} aria-label={t(label)} onClick={() => runAction(action)}>
      <Icon name={iconName} size={16} />
    </button>
  );

  return (
    <>
      <button type="button" class="titlebar__button titlebar__button--guide" data-action="guide" title={t("titlebar.guide")} aria-label={t("titlebar.guide")} hidden={!state.integrated()} onClick={() => runAction("guide")}>
        <Icon name="guide" size={20} style={{ pointerEvents: "none", display: "inherit" }} />
      </button>
      <div class="titlebar__brand" style={{ display: "none" }} data-tauri-drag-region>
        <Icon name="brand" size={28} class="external-icon" style={{ pointerEvents: "none", display: "block", width: "28px", height: "20px" }} />
      </div>
      <div class="titlebar__group" role="group" aria-label={t("titlebar.youtubeNavigation")}>
        {navigationButton("back", "titlebar.back", "back")}
        {navigationButton("forward", "titlebar.forward", "forward")}
        {navigationButton("reload", "titlebar.reload", "reload")}
      </div>
      <div class="titlebar__spacer titlebar__spacer--left" data-tauri-drag-region />

      <div class="titlebar__search-container" role="search" hidden={!state.integrated()} ref={searchContainer}>
        <div class="titlebar__search-box">
          <div class="titlebar__search-input-wrapper">
            <input
              type="text"
              class="titlebar__search-input"
              value={query()}
              placeholder={t("titlebar.search")}
              autocomplete="off"
              spellcheck={false}
              aria-label={t("titlebar.search")}
              role="combobox"
              aria-autocomplete="list"
              aria-controls="titlebar-search-suggestions"
              aria-expanded={suggestions().length > 0}
              aria-activedescendant={selectedIndex() >= 0 ? `titlebar-suggestion-${selectedIndex()}` : undefined}
              ref={searchInput}
              onFocus={() => void updateSearchDropdown()}
              onInput={(event) => {
                setQuery(event.currentTarget.value);
                setSelectedIndex(-1);
                if (suggestTimer !== undefined) window.clearTimeout(suggestTimer);
                suggestTimer = window.setTimeout(() => void updateSearchDropdown(), 120);
              }}
              onKeyDown={(event) => {
                const items = suggestions();
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitSearch(selectedIndex() >= 0 ? items[selectedIndex()]?.text ?? query() : query());
                } else if (items.length > 0 && event.key === "ArrowDown") {
                  event.preventDefault();
                  highlight(selectedIndex() + 1 < items.length ? selectedIndex() + 1 : 0);
                } else if (items.length > 0 && event.key === "ArrowUp") {
                  event.preventDefault();
                  highlight(selectedIndex() - 1 >= 0 ? selectedIndex() - 1 : items.length - 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeSuggestions();
                }
              }}
            />
            <Show when={query().length > 0}>
              <button type="button" class="titlebar__search-clear" title={t("titlebar.clearSearch")} aria-label={t("titlebar.clearSearch")} onClick={() => {
                setQuery("");
                setSelectedIndex(-1);
                searchInput.focus();
                void updateSearchDropdown();
              }}>
                <Icon name="clear" size={18} style={{ pointerEvents: "none" }} />
              </button>
            </Show>
          </div>
          <button type="button" class="titlebar__search-submit" title={t("titlebar.search")} aria-label={t("titlebar.search")} onClick={() => submitSearch(query())}>
            <Icon name="search" size={20} style={{ pointerEvents: "none", display: "inherit" }} />
          </button>
        </div>
        <button type="button" class="titlebar__voice-button" data-action="voice" title={t("titlebar.voiceSearch")} aria-label={t("titlebar.voiceSearch")} onClick={() => runAction("voice")}>
          <Icon name="voice" size={20} style={{ pointerEvents: "none", display: "inherit" }} />
        </button>
        <div id="titlebar-search-suggestions" class="titlebar__search-suggestions" role="group" aria-label={t("titlebar.searchSuggestions")} hidden={suggestions().length === 0}>
          <For each={suggestions()}>
            {(item, index) => (
              <div
                class="titlebar__suggestion-item"
                classList={{ "titlebar__suggestion-item--history": item.isHistory, "titlebar__suggestion-item--selected": selectedIndex() === index() }}
              >
                <button type="button" class="titlebar__suggestion-choice" id={`titlebar-suggestion-${index()}`} aria-current={selectedIndex() === index() ? "true" : undefined} onClick={() => submitSearch(item.text)}>
                  <Icon name={item.isHistory ? "history" as IconName : "search"} size={18} class="titlebar__suggestion-icon" style={{ pointerEvents: "none" }} />
                  <span class="titlebar__suggestion-text">{item.text}</span>
                </button>
                <Show when={item.isHistory}>
                  <button type="button" class="titlebar__suggestion-remove" title={t("titlebar.removeSearchHistory")} aria-label={t("titlebar.removeSearchHistory")} onClick={(event) => {
                    event.stopPropagation();
                    removeSearchHistoryQuery(item.text);
                    void updateSearchDropdown();
                    searchInput.focus();
                  }}>
                    <Icon name="clear" size={16} style={{ pointerEvents: "none" }} />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="titlebar__spacer titlebar__spacer--right" data-tauri-drag-region />
      <nav class="titlebar__tabs" aria-label={t("titlebar.appActions")} hidden={state.style() === "icons"}>
        <For each={TABS}>{(tab) => renderTabButton(tab)}</For>
      </nav>
      <div class="titlebar__group titlebar__icons" role="group" aria-label={t("titlebar.appActions")} hidden={state.style() !== "icons"}>
        <For each={TABS}>{(tab) => renderTabButton(tab, true)}</For>
      </div>

      <div class="titlebar__auth-container" hidden={!state.integrated()} ref={authContainer}>
        <button type="button" class="titlebar__login-button" data-action="toggle-auth-menu" title={t("titlebar.login")} onClick={() => runAction("toggle-auth-menu")} hidden={state.auth().loggedIn}>
          <Icon name="account" size={20} style={{ pointerEvents: "none", display: "inherit" }} />
          <span class="titlebar__login-label">{t("titlebar.login")}</span>
        </button>
        <button type="button" class="titlebar__avatar-button" data-action="toggle-auth-menu" title={state.auth().displayName || t("titlebar.account")} aria-label={t("titlebar.account")} onClick={() => runAction("toggle-auth-menu")} hidden={!state.auth().loggedIn}>
          <Show when={state.auth().avatarUrl && !avatarFailed()}>
            <img class="titlebar__avatar-img" alt="" src={state.auth().avatarUrl!} referrerpolicy="no-referrer" onError={() => setAvatarFailed(true)} />
          </Show>
          <Show when={!state.auth().avatarUrl || avatarFailed()}>
            <span class="titlebar__avatar-fallback"><Icon name="account" size={20} /></span>
          </Show>
        </button>
      </div>

      <div class="titlebar__group titlebar__controls" role="group" aria-label={t("titlebar.windowControls")}>
        {navigationButton("minimize", "titlebar.minimize", "minimize", "titlebar__button--window")}
        <button type="button" class="titlebar__button titlebar__button--window" data-action="toggle-maximize" title={t(maximized() ? "titlebar.restore" : "titlebar.maximize")} aria-label={t(maximized() ? "titlebar.restore" : "titlebar.maximize")} onClick={() => runAction("toggle-maximize")}>
          <Show when={maximized()} fallback={<Icon name="maximize" size={16} />}><Icon name="restore" size={16} /></Show>
        </button>
        {navigationButton("close", "titlebar.close", "close", "titlebar__button--window titlebar__button--close")}
      </div>
    </>
  );
}

export function createTitlebar(actions: TitlebarActions): Titlebar {
  const element = document.createElement("header");
  element.className = "titlebar";
  element.dataset.tauriDragRegion = "deep";

  const [active, setActive] = createSignal<RouteId>("home");
  const [rpc, setRpc] = createSignal<RpcStatus>({ state: "disabled", detail: null });
  const [style, setStyle] = createSignal<TitlebarStyle>("tabs");
  const [integrated, setIntegrated] = createSignal(false);
  const [auth, setAuth] = createSignal<AuthSnapshot>({ loggedIn: false });
  const state: TitlebarState = {
    active,
    setActive,
    rpc,
    setRpc,
    style,
    setStyle,
    integrated,
    setIntegrated,
    auth,
    setAuth,
  };

  render(() => <TitlebarContent actions={actions} bar={element} state={state} />, element);

  return {
    element,
    setActive,
    setRpcStatus: setRpc,
    setStyle,
    setMastheadIntegrated: (value) => {
      setIntegrated(value);
      void api.setMastheadIntegrated(value).catch(() => undefined);
    },
    setAuth,
  };
}
