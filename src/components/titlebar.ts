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
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false" style="pointer-events: none;">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm0 14c-2.03 0-4.43-.82-6.14-2.88C7.55 15.8 9.68 15 12 15s4.45.8 6.14 2.12C16.43 19.18 14.03 20 12 20z" fill="currentColor"></path>
        </svg>
        <span class="titlebar__login-label">${t("titlebar.login")}</span>
      </button>

      <button
        type="button"
        class="titlebar__button titlebar__button--more"
        data-action="toggle-auth-menu"
        title="Mais opções"
        aria-label="Mais opções"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false" style="pointer-events: none;">
          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="currentColor"></path>
        </svg>
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

      <div class="yt-context-menu" hidden>
        <div class="yt-context-menu__header" hidden>
          <img class="yt-context-menu__header-avatar" src="" alt="Avatar" />
          <div class="yt-context-menu__header-info">
            <span class="yt-context-menu__header-name"></span>
            <span class="yt-context-menu__header-handle"></span>
          </div>
        </div>
        <div class="yt-context-menu__body"></div>
      </div>
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
  const moreButton = bar.querySelector<HTMLButtonElement>('.titlebar__button--more')!;
  const avatarButton = bar.querySelector<HTMLButtonElement>('.titlebar__avatar-button')!;
  const avatarImg = bar.querySelector<HTMLImageElement>(".titlebar__avatar-img")!;
  const contextMenu = bar.querySelector<HTMLElement>(".yt-context-menu")!;
  const contextHeader = contextMenu.querySelector<HTMLElement>(".yt-context-menu__header")!;
  const contextHeaderAvatar = contextMenu.querySelector<HTMLImageElement>(".yt-context-menu__header-avatar")!;
  const contextHeaderName = contextMenu.querySelector<HTMLElement>(".yt-context-menu__header-name")!;
  const contextHeaderHandle = contextMenu.querySelector<HTMLElement>(".yt-context-menu__header-handle")!;
  const contextBody = contextMenu.querySelector<HTMLElement>(".yt-context-menu__body")!;

  let currentAuth: AuthSnapshot = { loggedIn: false };
  let currentItems: { text: string; isHistory: boolean }[] = [];
  let selectedIndex = -1;
  let suggestTimer: number | undefined;

  const closeSuggestions = (): void => {
    suggestionsBox.hidden = true;
    suggestionsBox.replaceChildren();
    currentItems = [];
    selectedIndex = -1;
  };

  const closeContextMenu = (): void => {
    contextMenu.hidden = true;
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
          <svg viewBox="0 0 24 24" width="16" height="16" class="titlebar__suggestion-icon" focusable="false" style="pointer-events: none;">
            ${
              item.isHistory
                ? '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.1.8-1.3-4.5-2.7V7z" fill="currentColor"></path>'
                : '<path d="M20.87 20.17l-5.59-5.59A7.95 7.95 0 0017 9.5a8 8 0 10-8 8 7.95 7.95 0 005.08-1.72l5.59 5.59a.5.5 0 00.7 0l.5-.5a.5.5 0 000-.7zM9.5 16A6.5 6.5 0 1116 9.5 6.51 6.51 0 019.5 16z" fill="currentColor"></path>'
            }
          </svg>
          <span class="titlebar__suggestion-text">${escapeHtml(item.text)}</span>
          ${
            item.isHistory
              ? `
              <button type="button" class="titlebar__suggestion-remove" data-remove-query="${escapeHtml(item.text)}" title="Remover do histórico" aria-label="Remover">
                <svg viewBox="0 0 24 24" width="14" height="14" style="pointer-events: none;"><path d="M12.7 12l6.6 6.6-0.7 0.7-6.6-6.6-6.6 6.6-0.7-0.7 6.6-6.6-6.6-6.6 0.7-0.7 6.6 6.6 6.6-6.6 0.7 0.7-6.6 6.6z" fill="currentColor"></path></svg>
              </button>`
              : ""
          }
        </div>`,
      )
      .join("");

    suggestionsBox.hidden = false;
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

  const toggleAuthMenu = (): void => {
    if (!contextMenu.hidden) {
      closeContextMenu();
      return;
    }

    if (currentAuth.loggedIn) {
      contextHeader.hidden = false;
      contextHeaderAvatar.src = currentAuth.avatarUrl || "";
      contextHeaderName.textContent = currentAuth.displayName || "YouTube";
      contextHeaderHandle.textContent = currentAuth.handle || "";

      contextBody.innerHTML = `
        <button type="button" class="yt-context-menu__item" data-menu-action="channel">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm0 14c-2.03 0-4.43-.82-6.14-2.88C7.55 15.8 9.68 15 12 15s4.45.8 6.14 2.12C16.43 19.18 14.03 20 12 20z" fill="currentColor"></path></svg>
          <span>Seu canal</span>
        </button>
        <button type="button" class="yt-context-menu__item" data-menu-action="studio">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="m10 15 5-3-5-3v6zm11-12H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z" fill="currentColor"></path></svg>
          <span>YouTube Studio</span>
        </button>
        <button type="button" class="yt-context-menu__item" data-menu-action="switch-account">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z" fill="currentColor"></path></svg>
          <span>Alternar conta</span>
        </button>
        <button type="button" class="yt-context-menu__item" data-menu-action="logout">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" fill="currentColor"></path></svg>
          <span>Sair</span>
        </button>
        <div class="yt-context-menu__divider"></div>
        <button type="button" class="yt-context-menu__item" data-menu-action="purchases">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7-3c1.66 0 3 1.34 3 3H9c0-1.66 1.34-3 3-3zm7 17H5V8h14v12z" fill="currentColor"></path></svg>
          <span>Compras e assinaturas</span>
        </button>
        <button type="button" class="yt-context-menu__item" data-menu-action="your-data">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="currentColor"></path></svg>
          <span>Seus dados no YouTube</span>
        </button>
        <div class="yt-context-menu__divider"></div>
        <button type="button" class="yt-context-menu__item" data-menu-action="shortcuts">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" fill="currentColor"></path></svg>
          <span>Teclas de atalho</span>
        </button>
        <button type="button" class="yt-context-menu__item" data-menu-action="settings-app">
          ${icon("settings", 20)}
          <span>Ajustes do aplicativo</span>
        </button>
      `;
    } else {
      contextHeader.hidden = true;
      contextBody.innerHTML = `
        <button type="button" class="yt-context-menu__item yt-context-menu__item--highlight" data-menu-action="login">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm0 14c-2.03 0-4.43-.82-6.14-2.88C7.55 15.8 9.68 15 12 15s4.45.8 6.14 2.12C16.43 19.18 14.03 20 12 20z" fill="currentColor"></path></svg>
          <span>Fazer login</span>
        </button>
        <button type="button" class="yt-context-menu__item" data-menu-action="your-data">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="currentColor"></path></svg>
          <span>Seus dados no YouTube</span>
        </button>
        <div class="yt-context-menu__divider"></div>
        <button type="button" class="yt-context-menu__item" data-menu-action="shortcuts">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" fill="currentColor"></path></svg>
          <span>Teclas de atalho</span>
        </button>
        <button type="button" class="yt-context-menu__item" data-menu-action="settings-app">
          ${icon("settings", 20)}
          <span>Ajustes do aplicativo</span>
        </button>
        <button type="button" class="yt-context-menu__item" data-menu-action="help">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 16h-2v-2h2v2zm1.07-7.75l-.9.92C12.45 11.9 12 12.5 12 14h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.65z" fill="currentColor"></path></svg>
          <span>Ajuda e feedback</span>
        </button>
      `;
    }

    contextMenu.hidden = false;
  };

  contextBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest<HTMLButtonElement>("[data-menu-action]");
    if (!btn) return;

    closeContextMenu();
    const action = btn.dataset.menuAction;
    switch (action) {
      case "login":
      case "switch-account":
        actions.onNavigate("home");
        void api.ytNavigate("url:https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com");
        break;
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
      moreButton.hidden = true;
    } else {
      avatarButton.hidden = true;
      loginButton.hidden = false;
      moreButton.hidden = false;
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
