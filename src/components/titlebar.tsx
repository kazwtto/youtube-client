import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { autoUpdate, computePosition, flip, offset, shift, size } from "@floating-ui/dom";
import type { AnimationPlaybackControlsWithThen } from "motion";

import type { RouteId } from "../app/router";
import { APP_SECTIONS, type AppSection } from "../app/navigation";
import { t, type TranslationKey } from "../i18n";
import { api, type AuthSnapshot, type RpcStatus, type TitlebarStyle, type YoutubeNavState, type YoutubeTitlebarIcons } from "../lib/api";
import { animateFadeScaleIn, animateMotion, isMotionEnabled, playElementMotion, stopElementMotion } from "../lib/motion";
import { FloatingMenu } from "./floating-menu";
import { Icon, type IconName, type YoutubeIconName } from "./icons";

export interface TitlebarActions {
  /// Navigates the local interface to a route.
  onNavigate: (id: RouteId) => void;
  onRefreshAuth: () => void;
}

export interface Titlebar {
  element: HTMLElement;
  setActive: (id: RouteId) => void;
  setRpcStatus: (status: RpcStatus) => void;
  setStyle: (style: TitlebarStyle) => void;
  setMastheadIntegrated: (integrated: boolean) => void;
  setAuth: (auth: AuthSnapshot) => void;
  setAuthLoading: () => void;
  setAuthUnavailable: () => void;
  setYoutubeIcons: (icons: YoutubeTitlebarIcons) => void;
}

interface Suggestion {
  text: string;
  isHistory: boolean;
}

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
  authStatus: () => "loading" | "ready" | "unavailable";
  icons: () => YoutubeTitlebarIcons;
  setIcons: (value: YoutubeTitlebarIcons) => void;
}

type NavLayout = "tabs" | "icons" | "menu";
type TitlebarMenuKind = "account" | "sections" | null;

const ACCOUNT_ITEMS: Array<[string, TranslationKey, YoutubeIconName | IconName]> = [
  ["channel", "menu.channel", "account"],
  ["studio", "menu.studio", "studio"],
  ["switch-account", "menu.switchAccount", "switch-account"],
  ["logout", "menu.signOut", "logout"],
  ["purchases", "menu.purchases", "purchases"],
  ["your-data", "menu.yourData", "your-data"],
  ["shortcuts", "menu.shortcuts", "shortcuts"],
  ["settings-app", "menu.appSettings", "settings"],
];

function TitlebarContent(props: { actions: TitlebarActions; bar: HTMLElement; state: TitlebarState }) {
  const { state } = props;
  const [query, setQuery] = createSignal("");
  const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [maximized, setMaximized] = createSignal(false);
  const [avatarFailed, setAvatarFailed] = createSignal(false);
  const [menuAvatarFailed, setMenuAvatarFailed] = createSignal(false);
  const [activeMenu, setActiveMenu] = createSignal<TitlebarMenuKind>(null);
  const [canGoBack, setCanGoBack] = createSignal(false);
  const [canGoForward, setCanGoForward] = createSignal(false);
  const [voiceActive, setVoiceActive] = createSignal(false);
  const [barWidth, setBarWidth] = createSignal(
    typeof window !== "undefined" ? props.bar.clientWidth || window.innerWidth : 1280,
  );
  const [searchExpanded, setSearchExpanded] = createSignal(false);

  let avatarImage!: HTMLImageElement;
  let searchContainer!: HTMLDivElement;
  let searchBox!: HTMLDivElement;
  let searchBack!: HTMLButtonElement;
  let searchTrigger!: HTMLButtonElement;
  let searchInput!: HTMLInputElement;
  let suggestionsEl!: HTMLDivElement;
  let suggestTimer: number | undefined;
  let latestSuggestionRequest = 0;
  let authContainer!: HTMLDivElement;
  let loginButton!: HTMLButtonElement;
  let sectionsButton!: HTMLButtonElement;
  let controlsGroup!: HTMLDivElement;
  let tabList!: HTMLElement;
  let iconTabList!: HTMLDivElement;
  let indicatorFrame = 0;
  let indicatorRoute: RouteId | undefined;
  let indicatorNavLayout: NavLayout | undefined;
  let indicatorPosition: { x: number; width: number } | undefined;
  let indicatorAnimation: AnimationPlaybackControlsWithThen | null = null;
  let isClosingExpandedSearch = false;
  let stopFloatingSuggestions: (() => void) | undefined;
  let elevationDropTimer: number | undefined;
  let wasMenuOpen = false;
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];
  const appWindow = getCurrentWindow();

  const navLayout = createMemo<NavLayout>(() => {
    const style = state.style();
    const width = barWidth();
    const integrated = state.integrated();
    if (style === "compact") return "menu";
    if (style === "icons") {
      if ((integrated && width < 740) || (!integrated && width < 480)) return "menu";
      return "icons";
    }
    if (integrated) {
      if (width >= 1060) return "tabs";
      if (width >= 740) return "icons";
      return "menu";
    }
    if (width >= 680) return "tabs";
    if (width >= 480) return "icons";
    return "menu";
  });

  const compactAuth = createMemo(() => state.integrated() && barWidth() < 1060);
  const compactSearch = createMemo(() => state.integrated() && barWidth() < 620);
  const compactControls = createMemo(() => barWidth() < 680);

  let previousAuth = state.auth();
  createEffect(() => {
    const auth = state.auth();
    if (auth === previousAuth) return;
    previousAuth = auth;
    setAvatarFailed(false);
    setMenuAvatarFailed(false);
    if (auth.avatarUrl) avatarImage.src = auth.avatarUrl;
  });

  createEffect(() => {
    const menuOpen = activeMenu() !== null;
    const hasSuggestions = suggestions().length > 0;
    if (menuOpen || hasSuggestions) {
      if (elevationDropTimer !== undefined) {
        window.clearTimeout(elevationDropTimer);
        elevationDropTimer = undefined;
      }
      wasMenuOpen = menuOpen;
      void api.setUiElevation(true).catch(() => undefined);
      return;
    }
    const shouldDelayDrop = wasMenuOpen && isMotionEnabled();
    wasMenuOpen = false;
    if (shouldDelayDrop) {
      if (elevationDropTimer !== undefined) window.clearTimeout(elevationDropTimer);
      elevationDropTimer = window.setTimeout(() => {
        elevationDropTimer = undefined;
        if (activeMenu() === null && suggestions().length === 0) {
          void api.setUiElevation(false).catch(() => undefined);
        }
      }, 150);
    } else {
      void api.setUiElevation(false).catch(() => undefined);
    }
  });

  createEffect(() => {
    barWidth();
    const layout = navLayout();
    const compact = compactSearch();
    const expanded = compact && searchExpanded();
    props.bar.classList.toggle("titlebar--tabs-mode", layout === "tabs");
    props.bar.classList.toggle("titlebar--icons-mode", layout === "icons");
    props.bar.classList.toggle("titlebar--compact-mode", layout === "menu");
    props.bar.classList.toggle("titlebar--integrated-masthead", state.integrated());
    props.bar.classList.toggle("titlebar--compact-auth", compactAuth());
    props.bar.classList.toggle("titlebar--compact-controls", compactControls());
    props.bar.classList.toggle("titlebar--compact-search", compact);
    props.bar.classList.toggle("titlebar--search-expanded", expanded);
    if (controlsGroup) {
      props.bar.style.setProperty("--controls-width", `${controlsGroup.offsetWidth || (compactControls() ? 108 : 138)}px`);
    }
  });

  createEffect(() => {
    if (!compactSearch() && searchExpanded()) {
      isClosingExpandedSearch = false;
      stopElementMotion(searchBox);
      stopElementMotion(searchBack);
      setSearchExpanded(false);
    }
  });

  let previousNavLayout: NavLayout | undefined;
  createEffect(() => {
    const layout = navLayout();
    if (previousNavLayout !== undefined && previousNavLayout !== layout) {
      stopElementMotion(tabList);
      stopElementMotion(iconTabList);
      stopElementMotion(sectionsButton);
      const target = layout === "menu" ? sectionsButton : layout === "icons" ? iconTabList : tabList;
      if (target) {
        playElementMotion(target, { opacity: [0, 1], scale: [0.95, 1], y: [-2, 0] }, { duration: 0.2 });
      }
    }
    previousNavLayout = layout;
  });

  let previousCompactAuth: boolean | undefined;
  createEffect(() => {
    const compact = compactAuth();
    if (previousCompactAuth !== undefined && previousCompactAuth !== compact && loginButton && !loginButton.hidden) {
      playElementMotion(loginButton, { opacity: [0.65, 1], scale: [0.94, 1] }, { duration: 0.2 });
    }
    previousCompactAuth = compact;
  });

  let previousCompactSearch: boolean | undefined;
  createEffect(() => {
    const compact = compactSearch();
    if (previousCompactSearch !== undefined && previousCompactSearch !== compact) {
      stopElementMotion(searchTrigger);
      stopElementMotion(searchBox);
      if (compact && searchTrigger) {
        playElementMotion(
          searchTrigger,
          { opacity: [0, 1], scale: [0.78, 1] },
          { duration: 0.2 },
        );
      } else if (!compact && searchBox) {
        playElementMotion(
          searchBox,
          {
            opacity: [0.35, 1],
            clipPath: ["inset(0 100% 0 0 round 40px)", "inset(0 0% 0 0 round 40px)"],
          },
          { duration: 0.22 },
        );
      }
    }
    previousCompactSearch = compact;
  });

  const updateTabIndicator = (): void => {
    if (indicatorFrame) cancelAnimationFrame(indicatorFrame);
    indicatorFrame = requestAnimationFrame(() => {
      indicatorFrame = 0;
      const layout = navLayout();
      if (layout === "menu") return;
      const indicatorList = layout === "icons" && state.style() === "icons" ? iconTabList : tabList;
      if (!indicatorList || indicatorList.hidden) return;

      const activeTab = indicatorList.querySelector<HTMLButtonElement>(`[data-route="${state.active()}"]`);
      if (!activeTab) return;

      const listLeft = indicatorList.getBoundingClientRect().left;
      const activeBounds = activeTab.getBoundingClientRect();
      if (activeBounds.width <= 0) return;

      const inset = layout === "icons" || activeBounds.width <= 40 ? 4 : 11;
      const nextPosition = {
        x: Math.round((activeBounds.left - listLeft + inset) * 10) / 10,
        width: Math.max(0, Math.round((activeBounds.width - inset * 2) * 10) / 10),
      };
      const indicator = indicatorList.querySelector<HTMLElement>(".titlebar__tab-indicator");
      if (!indicator) return;

      const renderedIndicator = indicator.getBoundingClientRect();
      const startPosition = renderedIndicator.width > 0
        ? { x: renderedIndicator.left - listLeft, width: renderedIndicator.width }
        : indicatorPosition;
      const routeChanged = indicatorRoute !== undefined && indicatorRoute !== state.active();
      const sameLayout = indicatorNavLayout === layout;
      const shouldAnimate = routeChanged && sameLayout && startPosition !== undefined;

      indicatorAnimation?.stop();
      if (shouldAnimate) {
        indicatorAnimation = animateMotion(
          indicator,
          { x: [startPosition.x, nextPosition.x], width: [startPosition.width, nextPosition.width] },
          { duration: 0.22 },
        );
      } else {
        indicatorAnimation = animateMotion(
          indicator,
          { x: nextPosition.x, width: nextPosition.width },
          { duration: 0 },
        );
      }

      indicatorRoute = state.active();
      indicatorNavLayout = layout;
      indicatorPosition = nextPosition;

      if (indicatorList.dataset.indicatorReady !== "true") {
        indicatorList.dataset.indicatorReady = "true";
      }
    });
  };

  createEffect(() => {
    state.active();
    state.style();
    state.integrated();
    navLayout();
    barWidth();
    updateTabIndicator();
  });

  /* Disabled native YouTube suggestion bridge attempt, retained as a comment:
  let searchSuggestionsRequest = 0;
  let lastSearchFocusAt = 0;

  const closeNativeSuggestions = (): void => {
    const request = ++searchSuggestionsRequest;
    void api.ytNavigate(`eval:window.__ytdesktopSearchSuggestions?.close(${request})`).catch(console.error);
  };

  const updateNativeSuggestions = (activate = false): void => {
    if (state.active() !== "home" || !state.integrated()) return;
    const box = searchInput.closest(".titlebar__search-box")?.getBoundingClientRect();
    if (!box) return;
    const request = ++searchSuggestionsRequest;
    const args = JSON.stringify([searchInput.value, box.left, box.width, request, activate]);
    void api.ytNavigate(`eval:window.__ytdesktopSearchSuggestions?.update(...${args})`).catch(console.error);
  };

  Previous input handlers also activated this bridge on focus/click and forwarded
  each input event to updateNativeSuggestions(). The custom dropdown below replaces it.
  */
  const stopSuggestionsPositioning = (): void => {
    stopFloatingSuggestions?.();
    stopFloatingSuggestions = undefined;
  };

  const positionSuggestions = (): void => {
    if (!searchBox || !suggestionsEl || suggestionsEl.hidden) return;
    void computePosition(searchBox, suggestionsEl, {
      strategy: "fixed",
      placement: "bottom-start",
      middleware: [
        offset(6),
        flip({ padding: 8 }),
        shift({ padding: 8 }),
        size({
          padding: 8,
          apply({ rects, availableWidth, availableHeight }) {
            const targetWidth = Math.min(Math.max(rects.reference.width, 280), availableWidth);
            Object.assign(suggestionsEl.style, {
              width: `${Math.round(targetWidth)}px`,
              maxWidth: `${Math.round(availableWidth)}px`,
              maxHeight: `${Math.round(Math.min(360, availableHeight))}px`,
            });
          },
        }),
      ],
    }).then(({ x, y }) => {
      if (!suggestionsEl || suggestionsEl.hidden) return;
      Object.assign(suggestionsEl.style, {
        left: `${Math.round(x)}px`,
        top: `${Math.round(y)}px`,
      });
    });
  };

  const closeSuggestions = (): void => {
    latestSuggestionRequest += 1;
    if (suggestTimer !== undefined) {
      window.clearTimeout(suggestTimer);
      suggestTimer = undefined;
    }
    stopSuggestionsPositioning();
    setSuggestions([]);
    setSelectedIndex(-1);
  };

  const showSuggestions = (items: Suggestion[]): void => {
    const wasEmpty = suggestions().length === 0;
    setSuggestions(items);
    setSelectedIndex(-1);
    if (items.length === 0) {
      stopSuggestionsPositioning();
      return;
    }
    if (!stopFloatingSuggestions && searchBox && suggestionsEl) {
      stopFloatingSuggestions = autoUpdate(searchBox, suggestionsEl, positionSuggestions);
    }
    positionSuggestions();
    if (wasEmpty && suggestionsEl) {
      animateFadeScaleIn(suggestionsEl, 0.15, -6);
    }
  };

  const openExpandedSearch = (): void => {
    isClosingExpandedSearch = false;
    stopElementMotion(searchTrigger);
    stopElementMotion(searchBox);
    stopElementMotion(searchBack);
    setSearchExpanded(true);
    requestAnimationFrame(() => {
      if (searchBack) {
        playElementMotion(
          searchBack,
          { opacity: [0, 1], scale: [0.82, 1], x: [-6, 0] },
          { duration: 0.2 },
        );
      }
      if (searchBox) {
        playElementMotion(
          searchBox,
          {
            opacity: [0.35, 1],
            clipPath: ["inset(0 100% 0 0 round 40px)", "inset(0 0% 0 0 round 40px)"],
          },
          { duration: 0.22 },
        );
      }
      searchInput?.focus();
      void updateSearchDropdown();
    });
  };

  const closeExpandedSearch = (): void => {
    closeSuggestions();
    if (!compactSearch() || !searchExpanded() || isClosingExpandedSearch) return;
    if (!isMotionEnabled() || !searchBox) {
      setSearchExpanded(false);
      return;
    }
    isClosingExpandedSearch = true;
    const closingAnimation = playElementMotion(
      searchBox,
      {
        opacity: [1, 0],
        clipPath: ["inset(0 0% 0 0 round 40px)", "inset(0 100% 0 0 round 40px)"],
      },
      { duration: 0.16, keepStyles: true },
    );
    if (searchBack) {
      playElementMotion(
        searchBack,
        { opacity: [1, 0], scale: [1, 0.82], x: [0, -6] },
        { duration: 0.16, keepStyles: true },
      );
    }
    const finishClosing = (): void => {
      if (!isClosingExpandedSearch) return;
      isClosingExpandedSearch = false;
      stopElementMotion(searchBox);
      stopElementMotion(searchBack);
      setSearchExpanded(false);
      requestAnimationFrame(() => {
        if (searchTrigger && !searchTrigger.hidden) {
          playElementMotion(searchTrigger, { opacity: [0, 1], scale: [0.8, 1] }, { duration: 0.18 });
        }
      });
    };
    if (closingAnimation) {
      void closingAnimation.finished.finally(finishClosing);
    } else {
      finishClosing();
    }
  };

  const submitSearch = (raw: string): void => {
    const value = raw.trim();
    if (!value) return;
    saveSearchHistoryQuery(value);
    setQuery(value);
    closeSuggestions();
    if (compactSearch()) closeExpandedSearch();
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

  const toggleAuthMenu = (): void => {
    closeSuggestions();
    setActiveMenu((current) => (current === "account" ? null : "account"));
  };

  const toggleSectionsMenu = (): void => {
    closeSuggestions();
    setActiveMenu((current) => (current === "sections" ? null : "sections"));
  };

  const handleMenuAction = (action: string): void => {
    setActiveMenu(null);
    if (action.startsWith("section:")) {
      const route = action.slice("section:".length);
      const tab = APP_SECTIONS.find((item) => item.id === route);
      if (tab) props.actions.onNavigate(tab.id);
    } else if (action === "login") {
      void api.openAuthModal();
    } else if (action === "logout") {
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
        toggleAuthMenu();
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
    if (!searchContainer.contains(target)) {
      closeSuggestions();
      if (compactSearch() && searchExpanded()) closeExpandedSearch();
    }
  };

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    if (suggestions().length > 0) closeSuggestions();
    if (compactSearch() && searchExpanded()) closeExpandedSearch();
  };

  const onBarDoubleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button, [data-route], .titlebar__search-box, .titlebar__search-container")) return;
    runAction("toggle-maximize");
  };

  onMount(() => {
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onDocumentKeyDown);
    props.bar.addEventListener("dblclick", onBarDoubleClick);
    void syncMaximize();

    const syncBarWidth = (): void => {
      const next = props.bar.clientWidth || window.innerWidth;
      if (next > 0) setBarWidth(next);
      if (controlsGroup) {
        props.bar.style.setProperty("--controls-width", `${controlsGroup.offsetWidth || 138}px`);
      }
    };
    syncBarWidth();

    const barResizeObserver = new ResizeObserver(() => {
      syncBarWidth();
      updateTabIndicator();
    });
    barResizeObserver.observe(props.bar);

    const tabResizeObserver = new ResizeObserver(updateTabIndicator);
    tabResizeObserver.observe(tabList);
    tabResizeObserver.observe(iconTabList);
    window.addEventListener("resize", syncBarWidth);
    window.addEventListener("resize", updateTabIndicator);

    const register = (promise: Promise<UnlistenFn>): void => {
      void promise.then((stop) => {
        if (disposed) stop();
        else unlisteners.push(stop);
      }).catch(() => undefined);
    };
    register(appWindow.onResized(() => void syncMaximize()));
    register(
      listen<YoutubeNavState>("youtube://nav-state", (event) => {
        if (!event.payload) return;
        setCanGoBack(Boolean(event.payload.canGoBack));
        setCanGoForward(Boolean(event.payload.canGoForward));
      }).then((stop) => {
        void api.requestYoutubeNavState().catch(() => undefined);
        return stop;
      }),
    );
    register(
      listen<boolean>("youtube://voice-state", (event) => {
        setVoiceActive(Boolean(event.payload));
      }),
    );

    onCleanup(() => {
      disposed = true;
      closeSuggestions();
      if (elevationDropTimer !== undefined) window.clearTimeout(elevationDropTimer);
      indicatorAnimation?.stop();
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onDocumentKeyDown);
      props.bar.removeEventListener("dblclick", onBarDoubleClick);
      barResizeObserver.disconnect();
      tabResizeObserver.disconnect();
      window.removeEventListener("resize", syncBarWidth);
      window.removeEventListener("resize", updateTabIndicator);
      if (indicatorFrame) cancelAnimationFrame(indicatorFrame);
      for (const stop of unlisteners) stop();
    });
  });

  const renderTabButton = (tab: AppSection, iconOnly = false) => (
    <button
      type="button"
      class={iconOnly ? "titlebar__button titlebar__button--app" : "titlebar__tab"}
      classList={{
        "titlebar__tab--active": state.active() === tab.id,
        "titlebar__button--active": state.active() === tab.id,
      }}
      data-route={tab.id}
      title={tab.id === "rpc" ? rpcTitle() : t(tab.labelKey)}
      aria-label={iconOnly ? t(tab.labelKey) : undefined}
      aria-selected={state.active() === tab.id}
      aria-current={state.active() === tab.id ? "page" : undefined}
      role={iconOnly ? undefined : "tab"}
      onClick={() => props.actions.onNavigate(tab.id)}
    >
      <Show when={iconOnly} fallback={
        <>
          <Icon name={tab.icon} size={17} class="icon titlebar__tab-icon" />
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

  const navigationButton = (
    action: string,
    label: TranslationKey,
    iconName: IconName,
    className = "",
    disabled?: () => boolean,
  ) => (
    <button
      type="button"
      class={`titlebar__button ${className}`}
      data-action={action}
      title={t(label)}
      aria-label={t(label)}
      disabled={disabled ? disabled() : false}
      onClick={() => runAction(action)}
    >
      <Icon name={iconName} size={16} />
    </button>
  );

  return (
    <>
      <button type="button" class="titlebar__button titlebar__button--guide" data-action="guide" title={t("titlebar.guide")} aria-label={t("titlebar.guide")} hidden={!state.integrated()} onClick={() => runAction("guide")}>
        <Icon name="guide" source="youtube" rawSvg={state.icons().guide} size={20} style={{ pointerEvents: "none", display: "inherit" }} />
      </button>
      <div class="titlebar__brand" style={{ display: "none" }} data-tauri-drag-region>
        <Icon name="brand" size={28} class="external-icon" style={{ pointerEvents: "none", display: "block", width: "28px", height: "20px" }} />
      </div>
      <div class="titlebar__group" role="group" aria-label={t("titlebar.youtubeNavigation")}>
        {navigationButton("back", "titlebar.back", "back", "", () => !canGoBack())}
        {navigationButton("forward", "titlebar.forward", "forward", "", () => !canGoForward())}
        {navigationButton("reload", "titlebar.reload", "reload")}
      </div>
      <div class="titlebar__spacer titlebar__spacer--left" data-tauri-drag-region />
      <div
        class="titlebar__search-container"
        classList={{ "titlebar__search-container--expanded": compactSearch() && searchExpanded() }}
        role="search"
        hidden={!state.integrated()}
        ref={searchContainer}
      >
        <button
          type="button"
          class="titlebar__button titlebar__search-back"
          title={t("titlebar.back")}
          aria-label={t("titlebar.back")}
          hidden={!(compactSearch() && searchExpanded())}
          onClick={closeExpandedSearch}
          ref={searchBack}
        >
          <Icon name="back" size={16} />
        </button>
        <button
          type="button"
          class="titlebar__button titlebar__search-trigger"
          title={t("titlebar.search")}
          aria-label={t("titlebar.search")}
          aria-expanded={searchExpanded()}
          hidden={!compactSearch() || searchExpanded()}
          onClick={openExpandedSearch}
          ref={searchTrigger}
        >
          <Icon name="search" source="youtube" rawSvg={state.icons().search} size={20} style={{ pointerEvents: "none", display: "inherit" }} />
        </button>
        <div class="titlebar__search-box" hidden={compactSearch() && !searchExpanded()} ref={searchBox}>
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
                  if (compactSearch() && searchExpanded()) closeExpandedSearch();
                }
              }}
            />
            <button
              type="button"
              class="titlebar__search-clear"
              classList={{ "titlebar__search-clear--visible": query().length > 0 }}
              title={t("titlebar.clearSearch")}
              aria-label={t("titlebar.clearSearch")}
              aria-hidden={query().length === 0}
              tabIndex={query().length === 0 ? -1 : 0}
              onClick={() => {
                setQuery("");
                setSelectedIndex(-1);
                searchInput.focus();
                void updateSearchDropdown();
              }}
            >
              <Icon name="clear" size={18} style={{ pointerEvents: "none" }} />
            </button>
          </div>
          <button type="button" class="titlebar__search-submit" title={t("titlebar.search")} aria-label={t("titlebar.search")} onClick={() => submitSearch(query())}>
            <Icon name="search" source="youtube" rawSvg={state.icons().search} size={20} style={{ pointerEvents: "none", display: "inherit" }} />
          </button>
        </div>
        <div id="titlebar-search-suggestions" class="titlebar__search-suggestions" role="group" aria-label={t("titlebar.searchSuggestions")} hidden={suggestions().length === 0} ref={suggestionsEl}>
          <For each={suggestions()}>
            {(item, index) => (
              <div
                class="titlebar__suggestion-item"
                classList={{ "titlebar__suggestion-item--history": item.isHistory, "titlebar__suggestion-item--selected": selectedIndex() === index() }}
              >
                <button type="button" class="titlebar__suggestion-choice" id={`titlebar-suggestion-${index()}`} aria-current={selectedIndex() === index() ? "true" : undefined} onClick={() => submitSearch(item.text)}>
                  <Icon name={item.isHistory ? "history" : "search"} source="youtube" size={24} class="titlebar__suggestion-icon" style={{ pointerEvents: "none", display: "block", width: "24px", height: "24px", flex: "0 0 24px" }} />
                  <span class="titlebar__suggestion-text">{item.text}</span>
                </button>
                <Show when={item.isHistory}>
                  <button type="button" class="titlebar__suggestion-remove" title={t("titlebar.removeSearchHistory")} aria-label={t("titlebar.removeSearch")} onClick={(event) => {
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
        <button
          type="button"
          class="titlebar__voice-button"
          classList={{ "titlebar__voice-button--active": voiceActive() }}
          data-action="voice"
          title={t("titlebar.voiceSearch")}
          aria-label={t("titlebar.voiceSearch")}
          aria-pressed={voiceActive()}
          onClick={() => runAction("voice")}
        >
          <Icon name="voice" size={20} style={{ pointerEvents: "none", display: "inherit" }} />
        </button>
      </div>


      <div class="titlebar__spacer titlebar__spacer--right" data-tauri-drag-region />
      <nav class="titlebar__tabs" role="tablist" aria-label={t("titlebar.appActions")} hidden={navLayout() === "menu" || (navLayout() === "icons" && state.style() === "icons")} ref={tabList}>
        <For each={APP_SECTIONS}>{(tab) => renderTabButton(tab)}</For>
        <span class="titlebar__tab-indicator" aria-hidden="true" />
      </nav>
      <div class="titlebar__group titlebar__icons" role="group" aria-label={t("titlebar.appActions")} hidden={navLayout() !== "icons" || state.style() !== "icons"} ref={iconTabList}>
        <For each={APP_SECTIONS}>{(tab) => renderTabButton(tab, true)}</For>
        <span class="titlebar__tab-indicator" aria-hidden="true" />
      </div>
      <button
        type="button"
        class="titlebar__button titlebar__sections-menu"
        title={t("titlebar.sectionsMenu")}
        aria-label={t("titlebar.sectionsMenu")}
        aria-haspopup="menu"
        aria-expanded={activeMenu() === "sections"}
        onClick={toggleSectionsMenu}
        hidden={navLayout() !== "menu"}
        ref={sectionsButton}
      >
        <Icon name="chevron" size={18} />
      </button>

      <div class="titlebar__auth-container" hidden={!state.integrated()} ref={authContainer}>
        <Show when={state.authStatus() === "ready"} fallback={
          <Show when={state.authStatus() === "loading"} fallback={
            <button type="button" class="titlebar__avatar-button" title={t("youtube.retry")} aria-label={`${t("titlebar.account")}: ${t("youtube.retry")}`} onClick={props.actions.onRefreshAuth}>
              <Icon name="account" source="youtube" size={20} />
            </button>
          }>
            <span class="titlebar__auth-loading" role="status" aria-label={t("titlebar.accountLoading")} title={t("titlebar.accountLoading")}>
              <span class="titlebar__auth-loading-track"><span /></span>
            </span>
          </Show>
        }>
          <button
            type="button"
            class="titlebar__login-button"
            data-action="toggle-auth-menu"
            title={t("titlebar.login")}
            aria-haspopup="menu"
            aria-expanded={activeMenu() === "account"}
            onClick={() => runAction("toggle-auth-menu")}
            hidden={state.auth().loggedIn}
            ref={loginButton}
          >
            <Icon name="account" source="youtube" rawSvg={state.icons().account} size={20} style={{ pointerEvents: "none", display: "inherit" }} />
            <span class="titlebar__login-label">{t("titlebar.login")}</span>
          </button>
          <button
            type="button"
            class="titlebar__avatar-button"
            data-action="toggle-auth-menu"
            title={state.auth().displayName || t("titlebar.account")}
            aria-label={t("titlebar.account")}
            aria-haspopup="menu"
            aria-expanded={activeMenu() === "account"}
            onClick={() => runAction("toggle-auth-menu")}
            hidden={!state.auth().loggedIn}
          >
            <img
              class="titlebar__avatar-img"
              alt={t("titlebar.account")}
              src={state.auth().avatarUrl ?? ""}
              referrerpolicy="no-referrer"
              ref={avatarImage}
              style={{ display: state.auth().avatarUrl && !avatarFailed() ? "block" : "none" }}
              onError={() => setAvatarFailed(true)}
            />
            <span
              class="titlebar__avatar-fallback"
              aria-hidden="true"
              style={{ display: state.auth().avatarUrl && !avatarFailed() ? "none" : "flex" }}
            >
              <Icon name="account" source="youtube" rawSvg={state.icons().account} size={20} />
            </span>
          </button>
        </Show>
      </div>

      <FloatingMenu
        open={() => activeMenu() === "sections"}
        anchor={() => sectionsButton}
        placement="bottom-start"
        align="start"
        width={228}
        ariaLabel={t("titlebar.appActions")}
        onClose={() => setActiveMenu(null)}
      >
        <div class="yt-menu__body">
          <For each={APP_SECTIONS}>
            {({ id: route, labelKey, icon }) => {
              const selected = () => state.active() === route;
              return (
                <button
                  type="button"
                  class="yt-menu__item"
                  classList={{ "yt-menu__item--selected": selected() }}
                  role="menuitemradio"
                  aria-checked={selected()}
                  aria-current={selected() ? "page" : undefined}
                  onClick={() => handleMenuAction(`section:${route}`)}
                >
                  <Icon name={icon} size={20} />
                  <span>{t(labelKey)}</span>
                  <Show when={selected()}><Icon name="check" size={16} class="yt-menu__item-check" /></Show>
                </button>
              );
            }}
          </For>
        </div>
      </FloatingMenu>

      <FloatingMenu
        open={() => activeMenu() === "account"}
        anchor={() => authContainer}
        placement="bottom-end"
        align="end"
        width={260}
        ariaLabel={t("titlebar.account")}
        onClose={() => setActiveMenu(null)}
      >
        <Show
          when={state.auth().loggedIn}
          fallback={
            <div class="yt-menu__body">
              <button type="button" class="yt-menu__item yt-menu__item--highlight" role="menuitem" onClick={() => handleMenuAction("login")}>
                <Icon name="account" size={20} />
                <span>{t("menu.signIn")}</span>
              </button>
              <button type="button" class="yt-menu__item" role="menuitem" onClick={() => handleMenuAction("your-data")}>
                <Icon name="your-data" size={20} />
                <span>{t("menu.yourData")}</span>
              </button>
              <div class="yt-menu__divider" />
              <button type="button" class="yt-menu__item" role="menuitem" onClick={() => handleMenuAction("shortcuts")}>
                <Icon name="shortcuts" size={20} />
                <span>{t("menu.shortcuts")}</span>
              </button>
              <button type="button" class="yt-menu__item" role="menuitem" onClick={() => handleMenuAction("settings-app")}>
                <Icon name="settings" size={20} />
                <span>{t("menu.appSettings")}</span>
              </button>
              <button type="button" class="yt-menu__item" role="menuitem" onClick={() => handleMenuAction("help")}>
                <Icon name="help" size={20} />
                <span>{t("menu.help")}</span>
              </button>
            </div>
          }
        >
          <>
            <div class="yt-menu__header">
              <div class="yt-menu__avatar-container">
                <Show when={state.auth().avatarUrl}>
                  <img
                    class="yt-menu__header-avatar"
                    src={state.auth().avatarUrl!}
                    referrerpolicy="no-referrer"
                    alt=""
                    style={{ display: menuAvatarFailed() ? "none" : "block" }}
                    onError={() => setMenuAvatarFailed(true)}
                  />
                </Show>
                <span
                  class="yt-menu__header-avatar--fallback"
                  style={{ display: state.auth().avatarUrl && !menuAvatarFailed() ? "none" : "flex" }}
                >
                  <Icon name="account" size={24} />
                </span>
              </div>
              <div class="yt-menu__header-info">
                <span class="yt-menu__header-name">{state.auth().displayName || state.auth().handle || t("menu.myAccount")}</span>
                <Show when={state.auth().handle}><span class="yt-menu__header-handle">{state.auth().handle}</span></Show>
              </div>
            </div>
            <div class="yt-menu__body">
              <For each={ACCOUNT_ITEMS.slice(0, 4)}>
                {([action, label, icon]) => (
                  <button type="button" class="yt-menu__item" role="menuitem" onClick={() => handleMenuAction(action)}>
                    <Icon name={icon} size={20} />
                    <span>{t(label)}</span>
                  </button>
                )}
              </For>
              <div class="yt-menu__divider" />
              <For each={ACCOUNT_ITEMS.slice(4, 6)}>
                {([action, label, icon]) => (
                  <button type="button" class="yt-menu__item" role="menuitem" onClick={() => handleMenuAction(action)}>
                    <Icon name={icon} size={20} />
                    <span>{t(label)}</span>
                  </button>
                )}
              </For>
              <div class="yt-menu__divider" />
              <For each={ACCOUNT_ITEMS.slice(6)}>
                {([action, label, icon]) => (
                  <button type="button" class="yt-menu__item" role="menuitem" onClick={() => handleMenuAction(action)}>
                    <Icon name={icon} size={20} />
                    <span>{t(label)}</span>
                  </button>
                )}
              </For>
            </div>
          </>
        </Show>
      </FloatingMenu>

      <div class="titlebar__group titlebar__controls" role="group" aria-label={t("titlebar.windowControls")} ref={controlsGroup}>
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
  const [style, setStyle] = createSignal<TitlebarStyle>("icons");
  const [integrated, setIntegrated] = createSignal(false);
  const [auth, setAuth] = createSignal<AuthSnapshot>({ loggedIn: false });
  const [authStatus, setAuthStatus] = createSignal<"loading" | "ready" | "unavailable">("loading");
  const [icons, setIcons] = createSignal<YoutubeTitlebarIcons>({});
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
    authStatus,
    icons,
    setIcons,
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
    setAuth: (value) => {
      setAuth(value);
      setAuthStatus("ready");
    },
    setAuthLoading: () => setAuthStatus("loading"),
    setAuthUnavailable: () => setAuthStatus("unavailable"),
    setYoutubeIcons: (value) => setIcons((previous) => ({ ...previous, ...value })),
  };
}
