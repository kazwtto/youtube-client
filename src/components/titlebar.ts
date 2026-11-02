import { getCurrentWindow } from "@tauri-apps/api/window";

import type { RouteId } from "../app/router";
import { t, type TranslationKey } from "../i18n";
import { api, type AuthSnapshot, type RpcStatus, type TitlebarStyle } from "../lib/api";
import { escapeHtml } from "../lib/html";
import { icon, type IconName } from "./icons";

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
      <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 0 24 24" width="20" focusable="false" style="pointer-events: none; display: inherit;">
        <path d="M20 5H4a1 1 0 000 2h16a1 1 0 100-2Zm0 6H4a1 1 0 000 2h16a1 1 0 000-2Zm0 6H4a1 1 0 000 2h16a1 1 0 000-2Z" fill="currentColor"></path>
      </svg>
    </button>

    <div class="titlebar__brand" data-tauri-drag-region>
      <svg xmlns="http://www.w3.org/2000/svg" class="external-icon" viewBox="0 0 28.57 20" focusable="false" style="pointer-events: none; display: block; width: 28px; height: 20px;">
        <g>
          <path d="M27.9727 3.12324C27.6435 1.89323 26.6768 0.926623 25.4468 0.597366C23.2197 2.24288e-07 14.285 0 14.285 0C14.285 0 5.35042 2.24288e-07 3.12323 0.597366C1.89323 0.926623 0.926623 1.89323 0.597366 3.12324C2.24288e-07 5.35042 0 10 0 10C0 10 2.24288e-07 14.6496 0.597366 16.8768C0.926623 18.1068 1.89323 19.0734 3.12323 19.4026C5.35042 20 14.285 20 14.285 20C14.285 20 23.2197 20 25.4468 19.4026C26.6768 19.0734 27.6435 18.1068 27.9727 16.8768C28.5701 14.6496 28.5701 10 28.5701 10C28.5701 10 28.5677 5.35042 27.9727 3.12324Z" fill="#FF0000"></path>
          <path d="M11.4253 14.2854L18.8477 10.0004L11.4253 5.71533V14.2854Z" fill="white"></path>
        </g>
      </svg>
    </div>

    <div class="titlebar__group" role="group" aria-label="${t("titlebar.youtubeNavigation")}">
      <button type="button" class="titlebar__button" data-action="back" title="${t("titlebar.back")}" aria-label="${t("titlebar.back")}">${icon("back")}</button>
      <button type="button" class="titlebar__button" data-action="forward" title="${t("titlebar.forward")}" aria-label="${t("titlebar.forward")}">${icon("forward")}</button>
      <button type="button" class="titlebar__button" data-action="reload" title="${t("titlebar.reload")}" aria-label="${t("titlebar.reload")}">${icon("reload")}</button>
    </div>

    <nav class="titlebar__tabs" role="tablist" aria-label="${t("titlebar.appActions")}">
      ${tabButtons}
    </nav>

    <div class="titlebar__group titlebar__icons" role="group" aria-label="${t("titlebar.appActions")}" hidden>
      ${iconButtons}
    </div>

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
            <svg viewBox="0 0 24 24" width="18" height="18" focusable="false" style="pointer-events: none;"><path d="M12.7 12l6.6 6.6-0.7 0.7-6.6-6.6-6.6 6.6-0.7-0.7 6.6-6.6-6.6-6.6 0.7-0.7 6.6 6.6 6.6-6.6 0.7 0.7-6.6 6.6z" fill="currentColor"></path></svg>
          </button>
        </div>
        <button
          type="button"
          class="titlebar__search-submit"
          title="${t("titlebar.search")}"
          aria-label="${t("titlebar.search")}"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" focusable="false" style="pointer-events: none;">
            <path d="M20.87 20.17l-5.59-5.59A7.95 7.95 0 0017 9.5a8 8 0 10-8 8 7.95 7.95 0 005.08-1.72l5.59 5.59a.5.5 0 00.7 0l.5-.5a.5.5 0 000-.7zM9.5 16A6.5 6.5 0 1116 9.5 6.51 6.51 0 019.5 16z" fill="currentColor"></path>
          </svg>
        </button>
      </div>
      <button
        type="button"
        class="titlebar__voice-button"
        title="${t("titlebar.voiceSearch")}"
        aria-label="${t("titlebar.voiceSearch")}"
        data-action="voice"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false" style="pointer-events: none;">
          <path d="M12 3c-1.66 0-3 1.37-3 3.07v5.86c0 1.7 1.34 3.07 3 3.07s3-1.37 3-3.07V6.07C15 4.37 13.66 3 12 3zm6.5 6.07c0 3.32-2.69 6.02-6 6.02s-6-2.7-6-6.02H5c0 3.86 3.14 7 7 7s7-3.14 7-7h-1.5z" fill="currentColor"></path>
        </svg>
      </button>
      <div class="titlebar__search-suggestions" hidden></div>
    </div>

    <div class="titlebar__spacer" data-tauri-drag-region></div>

    <div class="titlebar__auth-container" hidden>
      <button
        type="button"
        class="titlebar__login-button"
        data-action="login"
        title="${t("titlebar.login")}"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false" style="pointer-events: none;">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm0 14c-2.03 0-4.43-.82-6.14-2.88C7.55 15.8 9.68 15 12 15s4.45.8 6.14 2.12C16.43 19.18 14.03 20 12 20z" fill="currentColor"></path>
        </svg>
        <span class="titlebar__login-label">${t("titlebar.login")}</span>
      </button>

      <button
        type="button"
        class="titlebar__avatar-button"
        data-action="avatar"
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
  const loginButton = bar.querySelector<HTMLButtonElement>('[data-action="login"]')!;
  const avatarButton = bar.querySelector<HTMLButtonElement>('[data-action="avatar"]')!;
  const avatarImg = bar.querySelector<HTMLImageElement>(".titlebar__avatar-img")!;

  let currentSuggestions: string[] = [];
  let selectedSuggestionIndex = -1;
  let suggestTimer: number | undefined;

  const closeSuggestions = (): void => {
    suggestionsBox.hidden = true;
    suggestionsBox.replaceChildren();
    currentSuggestions = [];
    selectedSuggestionIndex = -1;
  };

  const submitSearch = (query: string): void => {
    const q = query.trim();
    if (!q) {
      return;
    }
    closeSuggestions();
    searchInput.value = q;
    searchClear.hidden = false;
    actions.onNavigate("home");
    void api.ytNavigate(`search:${encodeURIComponent(q)}`);
  };

  const renderSuggestions = (list: string[]): void => {
    currentSuggestions = list;
    selectedSuggestionIndex = -1;
    if (list.length === 0) {
      closeSuggestions();
      return;
    }

    suggestionsBox.innerHTML = list
      .map(
        (item, idx) => `
        <div class="titlebar__suggestion-item" data-index="${idx}">
          <svg viewBox="0 0 24 24" width="16" height="16" class="titlebar__suggestion-icon" focusable="false" style="pointer-events: none;">
            <path d="M20.87 20.17l-5.59-5.59A7.95 7.95 0 0017 9.5a8 8 0 10-8 8 7.95 7.95 0 005.08-1.72l5.59 5.59a.5.5 0 00.7 0l.5-.5a.5.5 0 000-.7zM9.5 16A6.5 6.5 0 1116 9.5 6.51 6.51 0 019.5 16z" fill="currentColor"></path>
          </svg>
          <span class="titlebar__suggestion-text">${escapeHtml(item)}</span>
        </div>`,
      )
      .join("");

    suggestionsBox.hidden = false;
  };

  const highlightSuggestion = (index: number): void => {
    const items = suggestionsBox.querySelectorAll<HTMLElement>(".titlebar__suggestion-item");
    items.forEach((el, idx) => {
      const active = idx === index;
      el.classList.toggle("titlebar__suggestion-item--selected", active);
    });

    if (index >= 0 && index < currentSuggestions.length) {
      searchInput.value = currentSuggestions[index];
      searchClear.hidden = false;
    }
  };

  searchInput.addEventListener("input", () => {
    const query = searchInput.value;
    searchClear.hidden = query.length === 0;

    if (suggestTimer !== undefined) {
      window.clearTimeout(suggestTimer);
    }

    if (!query.trim()) {
      closeSuggestions();
      return;
    }

    suggestTimer = window.setTimeout(async () => {
      try {
        const results = await api.fetchSuggestions(query);
        if (searchInput === document.activeElement && query === searchInput.value) {
          renderSuggestions(results);
        }
      } catch {
        closeSuggestions();
      }
    }, 150);
  });

  searchInput.addEventListener("keydown", (event) => {
    if (suggestionsBox.hidden || currentSuggestions.length === 0) {
      if (event.key === "Enter") {
        event.preventDefault();
        submitSearch(searchInput.value);
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        selectedSuggestionIndex =
          selectedSuggestionIndex + 1 < currentSuggestions.length
            ? selectedSuggestionIndex + 1
            : 0;
        highlightSuggestion(selectedSuggestionIndex);
        break;

      case "ArrowUp":
        event.preventDefault();
        selectedSuggestionIndex =
          selectedSuggestionIndex - 1 >= 0
            ? selectedSuggestionIndex - 1
            : currentSuggestions.length - 1;
        highlightSuggestion(selectedSuggestionIndex);
        break;

      case "Enter":
        event.preventDefault();
        if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < currentSuggestions.length) {
          submitSearch(currentSuggestions[selectedSuggestionIndex]);
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
    const item = target.closest<HTMLElement>(".titlebar__suggestion-item");
    if (!item) {
      return;
    }
    const idx = Number(item.dataset.index);
    if (!Number.isNaN(idx) && currentSuggestions[idx]) {
      submitSearch(currentSuggestions[idx]);
    }
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.hidden = true;
    closeSuggestions();
    searchInput.focus();
  });

  searchSubmit.addEventListener("click", () => {
    submitSearch(searchInput.value);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (!searchContainer.contains(target)) {
      closeSuggestions();
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
      actions.onNavigate(routeButton.dataset.route as RouteId);
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
      case "avatar":
        await api.ytNavigate(action);
        break;

      case "login":
        actions.onNavigate("home");
        await api.ytNavigate(
          "url:https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com",
        );
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

  void syncMaximizeIcon();
  void appWindow.onResized(() => {
    void syncMaximizeIcon();
  });

  return { element: bar, setActive, setRpcStatus, setStyle, setMastheadIntegrated, setAuth };
}
