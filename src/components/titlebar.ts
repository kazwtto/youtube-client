import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { RouteId } from "../app/router";
import { t, type TranslationKey } from "../i18n";
import { api, type AuthSnapshot, type RpcStatus, type TitlebarStyle } from "../lib/api";
import { escapeHtml } from "../lib/html";
import { icon, ytIcon, type IconName } from "./icons";

export interface TitlebarActions {
  /// Navigates the local interface to a route.
  onNavigate: (id: RouteId) => void;
}

export interface Titlebar {
  element: HTMLElement;
  setActive: (id: RouteId) => void;
  setRpcStatus: (status: RpcStatus) => void;
  setStyle: (style: TitlebarStyle) => void;
  setMastheadIntegrated: (integrated: boolean) => void;
  setAuth: (auth: AuthSnapshot) => void;
  updateLanguage: () => void;
}

interface Tab {
  id: RouteId;
  labelKey: TranslationKey;
  icon: IconName;
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
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
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
    // Ignore storage quota
  }
}

function removeSearchHistoryQuery(query: string): void {
  try {
    const current = getSearchHistory().filter((item) => item.toLowerCase() !== query.toLowerCase());
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage errors
  }
}

export function createTitlebar(actions: TitlebarActions): Titlebar {
  const bar = document.createElement("header");
  bar.className = "titlebar";
  bar.dataset.tauriDragRegion = "deep";

  const tabButtons = TABS.map(
    (tab) => `
      <button
        type="button"
        class="titlebar__tab"
        role="tab"
        data-route="${tab.id}"
        title="${t(tab.labelKey)}"
      >
        <span class="titlebar__tab-label">${t(tab.labelKey)}</span>
        ${tab.id === "rpc" ? '<span class="titlebar__dot" data-rpc-state="disabled" aria-hidden="true"></span>' : ""}
      </button>`,
  ).join("");

  const iconButtons = TABS.map(
    (tab) => `
      <button
        type="button"
        class="titlebar__button titlebar__button--app"
        data-route="${tab.id}"
        title="${t(tab.labelKey)}"
        aria-label="${t(tab.labelKey)}"
      >
        ${icon(tab.icon, 17)}
        ${tab.id === "rpc" ? '<span class="titlebar__status" data-rpc-state="disabled" aria-hidden="true"></span>' : ""}
      </button>`,
  ).join("");

  bar.innerHTML = `
    <button
      type="button"
      class="titlebar__button titlebar__button--guide"
      data-action="guide"
      title="${t("titlebar.guide")}"
      aria-label="${t("titlebar.guide")}"
      hidden
    >
      ${ytIcon("guide", 20, undefined, "pointer-events: none; display: inherit;")}
    </button>

    <div class="titlebar__brand" style="display: none" data-tauri-drag-region>
      ${ytIcon("brand", undefined, "external-icon", "pointer-events: none; display: block; width: 28px; height: 20px;")}
    </div>

    <div class="titlebar__group" role="group" aria-label="${t("titlebar.youtubeNavigation")}">
      <button type="button" class="titlebar__button" data-action="back" title="${t("titlebar.back")}" aria-label="${t("titlebar.back")}">${icon("back")}</button>
      <button type="button" class="titlebar__button" data-action="forward" title="${t("titlebar.forward")}" aria-label="${t("titlebar.forward")}">${icon("forward")}</button>
      <button type="button" class="titlebar__button" data-action="reload" title="${t("titlebar.reload")}" aria-label="${t("titlebar.reload")}">${icon("reload")}</button>
    </div>

    <div class="titlebar__spacer titlebar__spacer--left" data-tauri-drag-region></div>

    <div class="titlebar__search-container" role="search" hidden>
      <div class="titlebar__search-box">
        <div class="titlebar__search-input-wrapper">
          <input
            type="text"
            class="titlebar__search-input"
            placeholder="${t("titlebar.search")}"
            autocomplete="off"
            spellcheck="false"
            aria-label="${t("titlebar.search")}"
          />
          <button
            type="button"
            class="titlebar__search-clear"
            title="${t("titlebar.clearSearch")}"
            aria-label="${t("titlebar.clearSearch")}"
            hidden
          >
            ${ytIcon("clear", 18, undefined, "pointer-events: none;")}
          </button>
        </div>
        <button
          type="button"
          class="titlebar__search-submit"
          title="${t("titlebar.search")}"
          aria-label="${t("titlebar.search")}"
        >
          ${ytIcon("search", 20, undefined, "pointer-events: none; display: inherit;")}
        </button>
      </div>
      <button
        type="button"
        class="titlebar__voice-button"
        title="${t("titlebar.voiceSearch")}"
        aria-label="${t("titlebar.voiceSearch")}"
        data-action="voice"
      >
        ${ytIcon("voice", 20, undefined, "pointer-events: none; display: inherit;")}
      </button>
      <div class="titlebar__search-suggestions" hidden></div>
    </div>

    <div class="titlebar__spacer titlebar__spacer--right" data-tauri-drag-region></div>

    <nav class="titlebar__tabs" role="tablist" aria-label="${t("titlebar.appActions")}">
      ${tabButtons}
    </nav>

    <div class="titlebar__group titlebar__icons" role="group" aria-label="${t("titlebar.appActions")}" hidden>
      ${iconButtons}
    </div>

    <div class="titlebar__auth-container" hidden>
      <button
        type="button"
        class="titlebar__login-button"
        data-action="toggle-auth-menu"
        title="${t("titlebar.login")}"
      >
        ${ytIcon("account", 20, undefined, "pointer-events: none; display: inherit;")}
        <span class="titlebar__login-label">${t("titlebar.login")}</span>
      </button>

      <button
        type="button"
        class="titlebar__avatar-button"
        data-action="toggle-auth-menu"
        title="${t("titlebar.account")}"
        hidden
      >
        <img class="titlebar__avatar-img" alt="${t("titlebar.account")}" src="" />
      </button>
    </div>

    <div class="titlebar__group titlebar__controls" role="group" aria-label="${t("titlebar.windowControls")}">
      <button type="button" class="titlebar__button titlebar__button--window" data-action="minimize" title="${t("titlebar.minimize")}" aria-label="${t("titlebar.minimize")}">${icon("minimize")}</button>
      <button type="button" class="titlebar__button titlebar__button--window" data-action="toggle-maximize" title="${t("titlebar.maximize")}" aria-label="${t("titlebar.maximize")}">${icon("maximize")}</button>
      <button type="button" class="titlebar__button titlebar__button--window titlebar__button--close" data-action="close" title="${t("titlebar.close")}" aria-label="${t("titlebar.close")}">${icon("close")}</button>
    </div>
  `;

  const appWindow = getCurrentWindow();
  const maximizeButton = bar.querySelector<HTMLButtonElement>('[data-action="toggle-maximize"]');
  const tabsNav = bar.querySelector<HTMLElement>(".titlebar__tabs")!;
  const iconsNav = bar.querySelector<HTMLElement>(".titlebar__icons")!;
  const guideButton = bar.querySelector<HTMLButtonElement>('[data-action="guide"]')!;
  const searchContainer = bar.querySelector<HTMLElement>(".titlebar__search-container")!;
  const searchInput = bar.querySelector<HTMLInputElement>(".titlebar__search-input")!;
  const searchClear = bar.querySelector<HTMLButtonElement>(".titlebar__search-clear")!;
  const searchSubmit = bar.querySelector<HTMLButtonElement>(".titlebar__search-submit")!;
  const suggestionsBox = bar.querySelector<HTMLElement>(".titlebar__search-suggestions")!;
  const authContainer = bar.querySelector<HTMLElement>(".titlebar__auth-container")!;
  const loginButton = bar.querySelector<HTMLButtonElement>('.titlebar__login-button')!;
  const avatarButton = bar.querySelector<HTMLButtonElement>('.titlebar__avatar-button')!;
  const avatarImg = bar.querySelector<HTMLImageElement>(".titlebar__avatar-img")!;
  let currentAuth: AuthSnapshot = { loggedIn: false };
  let currentItems: { text: string; isHistory: boolean }[] = [];
  let selectedIndex = -1;
  let suggestTimer: number | undefined;

  const updateElevation = (): void => {
    const isElevated = !suggestionsBox.hidden;
    void api.setUiElevation(isElevated).catch(() => undefined);
  };

  const closeSuggestions = (): void => {
    suggestionsBox.hidden = true;
    suggestionsBox.replaceChildren();
    currentItems = [];
    selectedIndex = -1;
    updateElevation();
  };

  const closeContextMenu = (): void => {
    void api.hideContextMenu().catch(() => undefined);
  };

  const submitSearch = (query: string): void => {
    const q = query.trim();
    if (!q) {
      return;
    }
    saveSearchHistoryQuery(q);
    closeSuggestions();
    searchInput.value = q;
    searchClear.hidden = false;
    actions.onNavigate("home");
    void api.ytNavigate(`search:${encodeURIComponent(q)}`);
  };

  const renderDropdown = (items: { text: string; isHistory: boolean }[]): void => {
    currentItems = items;
    selectedIndex = -1;
    if (items.length === 0) {
      closeSuggestions();
      return;
    }

    suggestionsBox.innerHTML = items
      .map(
        (item, idx) => `
        <div class="titlebar__suggestion-item ${item.isHistory ? "titlebar__suggestion-item--history" : ""}" data-index="${idx}" data-query="${escapeHtml(item.text)}">
          ${
            item.isHistory
              ? ytIcon("history", 18, "titlebar__suggestion-icon", "pointer-events: none;")
              : ytIcon("search", 18, "titlebar__suggestion-icon", "pointer-events: none;")
          }
          <span class="titlebar__suggestion-text">${escapeHtml(item.text)}</span>
          ${
            item.isHistory
              ? `
              <button type="button" class="titlebar__suggestion-remove" data-remove-query="${escapeHtml(item.text)}" title="Remover do histórico" aria-label="Remover">
                ${ytIcon("clear", 16, undefined, "pointer-events: none;")}
              </button>`
              : ""
          }
        </div>`,
      )
      .join("");

    suggestionsBox.hidden = false;
    updateElevation();
  };

  const updateSearchDropdown = async (): Promise<void> => {
    const rawVal = searchInput.value;
    const query = rawVal.trim().toLowerCase();
    const history = getSearchHistory();

    if (!query) {
      const historyItems = history.map((text) => ({ text, isHistory: true }));
      renderDropdown(historyItems);
      return;
    }

    const matchedHistory = history
      .filter((h) => h.toLowerCase().includes(query))
      .map((text) => ({ text, isHistory: true }));

    try {
      const remote = await api.fetchSuggestions(rawVal);
      const filteredRemote = remote
        .filter((r) => !matchedHistory.some((h) => h.text.toLowerCase() === r.toLowerCase()))
        .map((text) => ({ text, isHistory: false }));

      const combined = [...matchedHistory, ...filteredRemote];
      if (searchInput === document.activeElement && searchInput.value === rawVal) {
        renderDropdown(combined);
      }
    } catch {
      if (matchedHistory.length > 0) {
        renderDropdown(matchedHistory);
      } else {
        closeSuggestions();
      }
    }
  };

  const highlightIndex = (index: number): void => {
    const items = suggestionsBox.querySelectorAll<HTMLElement>(".titlebar__suggestion-item");
    items.forEach((el, idx) => {
      el.classList.toggle("titlebar__suggestion-item--selected", idx === index);
    });

    if (index >= 0 && index < currentItems.length) {
      searchInput.value = currentItems[index].text;
      searchClear.hidden = false;
    }
  };

  searchInput.addEventListener("focus", () => {
    void updateSearchDropdown();
  });

  searchInput.addEventListener("input", () => {
    searchClear.hidden = searchInput.value.length === 0;
    if (suggestTimer !== undefined) {
      window.clearTimeout(suggestTimer);
    }
    suggestTimer = window.setTimeout(() => {
      void updateSearchDropdown();
    }, 120);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (suggestionsBox.hidden || currentItems.length === 0) {
      if (event.key === "Enter") {
        event.preventDefault();
        submitSearch(searchInput.value);
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        selectedIndex = selectedIndex + 1 < currentItems.length ? selectedIndex + 1 : 0;
        highlightIndex(selectedIndex);
        break;

      case "ArrowUp":
        event.preventDefault();
        selectedIndex = selectedIndex - 1 >= 0 ? selectedIndex - 1 : currentItems.length - 1;
        highlightIndex(selectedIndex);
        break;

      case "Enter":
        event.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < currentItems.length) {
          submitSearch(currentItems[selectedIndex].text);
        } else {
          submitSearch(searchInput.value);
        }
        break;

      case "Escape":
        event.preventDefault();
        closeSuggestions();
        break;

      default:
        break;
    }
  });

  suggestionsBox.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const removeBtn = target.closest<HTMLButtonElement>("[data-remove-query]");
    if (removeBtn && removeBtn.dataset.removeQuery) {
      event.stopPropagation();
      removeSearchHistoryQuery(removeBtn.dataset.removeQuery);
      void updateSearchDropdown();
      searchInput.focus();
      return;
    }

    const item = target.closest<HTMLElement>(".titlebar__suggestion-item");
    if (item && item.dataset.query) {
      submitSearch(item.dataset.query);
    }
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.hidden = true;
    searchInput.focus();
    void updateSearchDropdown();
  });

  searchSubmit.addEventListener("click", () => {
    submitSearch(searchInput.value);
  });

  let lastMenuCloseTime = 0;

  void listen("menu://closed", () => {
    lastMenuCloseTime = Date.now();
  });

  const toggleAuthMenu = async (): Promise<void> => {
    if (Date.now() - lastMenuCloseTime < 220) {
      return;
    }

    const isVisible = await api.isContextMenuVisible();
    if (isVisible) {
      await api.hideContextMenu();
      return;
    }

    const rect = authContainer.getBoundingClientRect();
    const outerPos = await appWindow.outerPosition();
    const scale = await appWindow.scaleFactor();

    const isLogged = currentAuth.loggedIn;
    const menuWidth = 260;
    const menuHeight = isLogged ? 430 : 230;

    const PAD_X = 24;
    const PAD_TOP = 8;
    const PAD_BOTTOM = 36;

    const windowWidth = menuWidth + (PAD_X * 2);
    const windowHeight = menuHeight + PAD_TOP + PAD_BOTTOM;

    const screenRight = (outerPos.x / scale) + rect.right;
    const screenBottom = (outerPos.y / scale) + rect.bottom;

    const targetX = Math.round(screenRight - menuWidth - PAD_X);
    const targetY = Math.round(screenBottom + 6 - PAD_TOP);

    await api.showContextMenu({
      x: targetX,
      y: targetY,
      width: windowWidth,
      height: windowHeight,
      auth: currentAuth,
    });
  };

  const handleContextMenuAction = (action: string): void => {
    switch (action) {
      case "logout":
        actions.onNavigate("home");
        void api.ytNavigate("url:https://www.youtube.com/logout");
        break;
      case "channel":
        actions.onNavigate("home");
        void api.ytNavigate("url:https://www.youtube.com/feed/library");
        break;
      case "studio":
        actions.onNavigate("home");
        void api.ytNavigate("url:https://studio.youtube.com");
        break;
      case "purchases":
        actions.onNavigate("home");
        void api.ytNavigate("url:https://www.youtube.com/paid_memberships");
        break;
      case "your-data":
        actions.onNavigate("home");
        void api.ytNavigate("url:https://myaccount.google.com/yourdata/youtube");
        break;
      case "shortcuts":
        actions.onNavigate("home");
        void api.ytNavigate("eval:(function(){ document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true })); })()");
        break;
      case "settings-app":
        actions.onNavigate("settings");
        break;
      case "help":
        actions.onNavigate("home");
        void api.ytNavigate("url:https://support.google.com/youtube");
        break;
      default:
        break;
    }
  };

  void listen<{ action: string }>("menu-action", (event) => {
    const action = event.payload?.action;
    if (action) {
      handleContextMenuAction(action);
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (!searchContainer.contains(target)) {
      closeSuggestions();
    }
    if (!authContainer.contains(target)) {
      closeContextMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeContextMenu();
      if (!suggestionsBox.hidden) {
        closeSuggestions();
      }
    }
  });

  bar.addEventListener("dblclick", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (
      target.closest("button") ||
      target.closest("[data-route]") ||
      target.closest(".titlebar__search-box")
    ) {
      return;
    }
    void handleAction("toggle-maximize");
  });

  bar.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const routeButton = target.closest<HTMLElement>("[data-route]");
    if (routeButton?.dataset.route) {
      const targetRoute = routeButton.dataset.route as RouteId;
      actions.onNavigate(targetRoute);
      if (targetRoute === "home") {
        void api.ytNavigate("eval:(function(){ if (!location.hostname.includes('youtube.com')) { location.href = 'https://www.youtube.com'; } })()");
      }
      return;
    }

    const button = target.closest<HTMLButtonElement>("[data-action]");
    if (button) {
      void handleAction(button.dataset.action);
    }
  });

  async function handleAction(action: string | undefined): Promise<void> {
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
        await syncMaximizeIcon();
        break;

      case "close":
        await appWindow.close();
        break;

      default:
        break;
    }
  }

  async function syncMaximizeIcon(): Promise<void> {
    if (!maximizeButton) {
      return;
    }

    try {
      const maximized = await appWindow.isMaximized();
      const label = t(maximized ? "titlebar.restore" : "titlebar.maximize");

      maximizeButton.innerHTML = icon(maximized ? "restore" : "maximize");
      maximizeButton.title = label;
      maximizeButton.setAttribute("aria-label", label);
    } catch {
      // The window may be closing; keep the current icon.
    }
  }

  function setActive(id: RouteId): void {
    for (const button of bar.querySelectorAll<HTMLElement>("[data-route]")) {
      const active = button.dataset.route === id;
      button.classList.toggle("titlebar__tab--active", active);
      button.classList.toggle("titlebar__button--active", active);

      if (active) {
        button.setAttribute("aria-selected", "true");
        button.setAttribute("aria-current", "page");
      } else {
        button.setAttribute("aria-selected", "false");
        button.removeAttribute("aria-current");
      }
    }
  }

  function setStyle(style: TitlebarStyle): void {
    const icons = style === "icons";
    tabsNav.hidden = icons;
    iconsNav.hidden = !icons;
    bar.classList.toggle("titlebar--icons-mode", icons);
  }

  function setMastheadIntegrated(integrated: boolean): void {
    guideButton.hidden = !integrated;
    searchContainer.hidden = !integrated;
    authContainer.hidden = !integrated;
    bar.classList.toggle("titlebar--integrated-masthead", integrated);
    void api.setMastheadIntegrated(integrated);
  }

  function setAuth(auth: AuthSnapshot): void {
    currentAuth = auth;
    if (auth.loggedIn && auth.avatarUrl) {
      avatarImg.src = auth.avatarUrl;
      avatarButton.hidden = false;
      loginButton.hidden = true;
    } else {
      avatarButton.hidden = true;
      loginButton.hidden = false;
    }
  }

  function setRpcStatus(status: RpcStatus): void {
    for (const dot of bar.querySelectorAll<HTMLElement>("[data-rpc-state]")) {
      dot.dataset.rpcState = status.state;
    }

    const tab = bar.querySelector<HTMLElement>('[data-route="rpc"]');
    if (tab) {
      const detail =
        status.state === "notConfigured"
          ? t("rpc.notConfiguredDetail")
          : (status.detail ?? t(("rpc.state." + status.state) as TranslationKey));
      tab.title = `${t("nav.discord")} — ${detail}`;
    }
  }

  function updateLanguage(): void {
    for (const btn of tabsNav.querySelectorAll<HTMLButtonElement>(".titlebar__tab")) {
      const route = btn.dataset.route as RouteId;
      const tab = TABS.find((t) => t.id === route);
      if (tab) {
        btn.title = t(tab.labelKey);
        const labelSpan = btn.querySelector(".titlebar__tab-label");
        if (labelSpan) {
          labelSpan.textContent = t(tab.labelKey);
        }
      }
    }

    for (const btn of iconsNav.querySelectorAll<HTMLButtonElement>(".titlebar__button--app")) {
      const route = btn.dataset.route as RouteId;
      const tab = TABS.find((t) => t.id === route);
      if (tab) {
        btn.title = t(tab.labelKey);
        btn.setAttribute("aria-label", t(tab.labelKey));
      }
    }

    guideButton.title = t("titlebar.guide");
    guideButton.setAttribute("aria-label", t("titlebar.guide"));

    const backBtn = bar.querySelector<HTMLButtonElement>('[data-action="back"]');
    if (backBtn) {
      backBtn.title = t("titlebar.back");
      backBtn.setAttribute("aria-label", t("titlebar.back"));
    }
    const forwardBtn = bar.querySelector<HTMLButtonElement>('[data-action="forward"]');
    if (forwardBtn) {
      forwardBtn.title = t("titlebar.forward");
      forwardBtn.setAttribute("aria-label", t("titlebar.forward"));
    }
    const reloadBtn = bar.querySelector<HTMLButtonElement>('[data-action="reload"]');
    if (reloadBtn) {
      reloadBtn.title = t("titlebar.reload");
      reloadBtn.setAttribute("aria-label", t("titlebar.reload"));
    }

    searchInput.placeholder = t("titlebar.search");
    searchInput.setAttribute("aria-label", t("titlebar.search"));
    searchClear.title = t("titlebar.clearSearch");
    searchClear.setAttribute("aria-label", t("titlebar.clearSearch"));
    searchSubmit.title = t("titlebar.search");
    searchSubmit.setAttribute("aria-label", t("titlebar.search"));

    const voiceBtn = bar.querySelector<HTMLButtonElement>('[data-action="voice"]');
    if (voiceBtn) {
      voiceBtn.title = t("titlebar.voiceSearch");
      voiceBtn.setAttribute("aria-label", t("titlebar.voiceSearch"));
    }

    loginButton.title = t("titlebar.login");
    const loginLabel = loginButton.querySelector(".titlebar__login-label");
    if (loginLabel) {
      loginLabel.textContent = t("titlebar.login");
    }

    avatarButton.title = t("titlebar.account");

    const minBtn = bar.querySelector<HTMLButtonElement>('[data-action="minimize"]');
    if (minBtn) {
      minBtn.title = t("titlebar.minimize");
      minBtn.setAttribute("aria-label", t("titlebar.minimize"));
    }
    const closeBtn = bar.querySelector<HTMLButtonElement>('[data-action="close"]');
    if (closeBtn) {
      closeBtn.title = t("titlebar.close");
      closeBtn.setAttribute("aria-label", t("titlebar.close"));
    }
    void syncMaximizeIcon();
  }

  void syncMaximizeIcon();
  void appWindow.onResized(() => {
    void syncMaximizeIcon();
  });

  return {
    element: bar,
    setActive,
    setRpcStatus,
    setStyle,
    setMastheadIntegrated,
    setAuth,
    updateLanguage,
  };
}
