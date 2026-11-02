import { getCurrentWindow } from "@tauri-apps/api/window";

import type { RouteId } from "../app/router";
import { t, type TranslationKey } from "../i18n";
import { api, type RpcStatus, type TitlebarStyle } from "../lib/api";
import { icon, type IconName } from "./icons";
// import ytdLOGO from "../../assets/branding/icon-source.png";

export interface TitlebarActions {
  /// Navigates the local interface to a route.
  onNavigate: (id: RouteId) => void;
}

export interface Titlebar {
  element: HTMLElement;
  setActive: (id: RouteId) => void;
  setRpcStatus: (status: RpcStatus) => void;
  setStyle: (style: TitlebarStyle) => void;
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
    <div class="titlebar__brand" data-tauri-drag-region>
    <svg xmlns="http://www.w3.org/2000/svg" class="external-icon" viewBox="0 0 28.57  20" focusable="false" style="pointer-events: none; display: block; width: 100%; height: 100%;">
      <svg viewBox="0 0 28.57 20" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
        <g>
          <path d="M27.9727 3.12324C27.6435 1.89323 26.6768 0.926623 25.4468 0.597366C23.2197 2.24288e-07 14.285 0 14.285 0C14.285 0 5.35042 2.24288e-07 3.12323 0.597366C1.89323 0.926623 0.926623 1.89323 0.597366 3.12324C2.24288e-07 5.35042 0 10 0 10C0 10 2.24288e-07 14.6496 0.597366 16.8768C0.926623 18.1068 1.89323 19.0734 3.12323 19.4026C5.35042 20 14.285 20 14.285 20C14.285 20 23.2197 20 25.4468 19.4026C26.6768 19.0734 27.6435 18.1068 27.9727 16.8768C28.5701 14.6496 28.5701 10 28.5701 10C28.5701 10 28.5677 5.35042 27.9727 3.12324Z" fill="#FF0000"></path>
          <path d="M11.4253 14.2854L18.8477 10.0004L11.4253 5.71533V14.2854Z" fill="white"></path>
        </g>
      </svg>
    </svg>
    </div>
    <button style="display: none" class="titlebar__brand" id="ytd_guide-button" data-tauri-drag-region>
      <span class="yt-icon-shape style-scope yt-icon ytSpecIconShapeHost"><div style="width: 100%; height: 100%; display: block; fill: currentcolor;"><svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" focusable="false" aria-hidden="true" style="pointer-events: none; display: inherit; width: 100%; height: 100%;"><path d="M20 5H4a1 1 0 000 2h16a1 1 0 100-2Zm0 6H4a1 1 0 000 2h16a1 1 0 000-2Zm0 6H4a1 1 0 000 2h16a1 1 0 000-2Z"></path></svg></div></span>
    </button>

    <div class="titlebar__group" role="group" aria-label="${t("titlebar.youtubeNavigation")}">
      <button type="button" class="titlebar__button" data-action="back" title="${t("titlebar.back")}" aria-label="${t("titlebar.back")}">${icon("back")}</button>
      <button type="button" class="titlebar__button" data-action="forward" title="${t("titlebar.forward")}" aria-label="${t("titlebar.forward")}">${icon("forward")}</button>
      <button type="button" class="titlebar__button" data-action="reload" title="${t("titlebar.reload")}" aria-label="${t("titlebar.reload")}">${icon("reload")}</button>
    </div>

    <nav class="titlebar__tabs" role="tablist" aria-label="${t("titlebar.appActions")}">
      ${tabButtons}
    </nav>

    <div class="titlebar__spacer" data-tauri-drag-region></div>

    <div class="titlebar__group titlebar__icons" role="group" aria-label="${t("titlebar.appActions")}" hidden>
      ${iconButtons}
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
        await api.ytNavigate(action);
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
          : (status.detail ?? t("rpc.state." + status.state as TranslationKey));
      tab.title = `${t("nav.discord")} — ${detail}`;
    }
  }

  void syncMaximizeIcon();
  void appWindow.onResized(() => {
    void syncMaximizeIcon();
  });

  return { element: bar, setActive, setRpcStatus, setStyle };
}
