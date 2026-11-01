import { getCurrentWindow } from "@tauri-apps/api/window";

import type { RouteId } from "../app/router";
import { t, type TranslationKey } from "../i18n";
import { api, type RpcStatus } from "../lib/api";
import { icon, type IconName } from "./icons";

export interface TitlebarActions {
  /// Navigates the local interface to a route.
  onNavigate: (id: RouteId) => void;
}

export interface Titlebar {
  element: HTMLElement;
  setActive: (id: RouteId) => void;
  setRpcStatus: (status: RpcStatus) => void;
}

interface AppAction {
  id: RouteId;
  labelKey: TranslationKey;
  icon: IconName;
}

const APP_ACTIONS: readonly AppAction[] = [
  { id: "history", labelKey: "nav.history", icon: "history" },
  { id: "extensions", labelKey: "nav.extensions", icon: "extensions" },
  { id: "rpc", labelKey: "nav.rpc", icon: "discord" },
  { id: "settings", labelKey: "nav.settings", icon: "settings" },
];

export function createTitlebar(actions: TitlebarActions): Titlebar {
  const bar = document.createElement("header");
  bar.className = "titlebar";
  bar.dataset.tauriDragRegion = "deep";

  const appButtons = APP_ACTIONS.map(
    (action) => `
      <button
        type="button"
        class="titlebar__button titlebar__button--app"
        data-route="${action.id}"
        title="${t(action.labelKey)}"
        aria-label="${t(action.labelKey)}"
      >
        ${icon(action.icon, 17)}
        ${action.id === "rpc" ? '<span class="titlebar__status" data-rpc-state="disabled" aria-hidden="true"></span>' : ""}
      </button>`,
  ).join("");

  bar.innerHTML = `
    <div class="titlebar__brand">
      <span class="titlebar__mark" aria-hidden="true">YT</span>
      <span class="titlebar__title">YT Desktop</span>
    </div>

    <div class="titlebar__group" role="group" aria-label="${t("titlebar.youtubeNavigation")}">
      <button type="button" class="titlebar__button" data-action="back" title="${t("titlebar.back")}" aria-label="${t("titlebar.back")}">${icon("back")}</button>
      <button type="button" class="titlebar__button" data-action="forward" title="${t("titlebar.forward")}" aria-label="${t("titlebar.forward")}">${icon("forward")}</button>
      <button type="button" class="titlebar__button" data-action="reload" title="${t("titlebar.reload")}" aria-label="${t("titlebar.reload")}">${icon("reload")}</button>
      <button type="button" class="titlebar__button" data-action="home" title="${t("titlebar.home")}" aria-label="${t("titlebar.home")}">${icon("home")}</button>
    </div>

    <div class="titlebar__spacer"></div>

    <div class="titlebar__group" role="group" aria-label="${t("titlebar.appActions")}">
      ${appButtons}
    </div>

    <div class="titlebar__group titlebar__controls" role="group" aria-label="${t("titlebar.windowControls")}">
      <button type="button" class="titlebar__button titlebar__button--window" data-action="minimize" title="${t("titlebar.minimize")}" aria-label="${t("titlebar.minimize")}">${icon("minimize")}</button>
      <button type="button" class="titlebar__button titlebar__button--window" data-action="toggle-maximize" title="${t("titlebar.maximize")}" aria-label="${t("titlebar.maximize")}">${icon("maximize")}</button>
      <button type="button" class="titlebar__button titlebar__button--window titlebar__button--close" data-action="close" title="${t("titlebar.close")}" aria-label="${t("titlebar.close")}">${icon("close")}</button>
    </div>
  `;

  const appWindow = getCurrentWindow();
  const maximizeButton = bar.querySelector<HTMLButtonElement>(
    '[data-action="toggle-maximize"]',
  );

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

      case "home":
        actions.onNavigate("home");
        await api.ytNavigate("home");
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
      button.classList.toggle("titlebar__button--active", active);

      if (active) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    }

    const homeButton = bar.querySelector<HTMLElement>('[data-action="home"]');
    const homeActive = id === "home";
    homeButton?.classList.toggle("titlebar__button--active", homeActive);

    if (homeActive) {
      homeButton?.setAttribute("aria-current", "page");
    } else {
      homeButton?.removeAttribute("aria-current");
    }
  }

  function setRpcStatus(status: RpcStatus): void {
    const dot = bar.querySelector<HTMLElement>("[data-rpc-state]");
    if (!dot) {
      return;
    }

    dot.dataset.rpcState = status.state;
    const button = dot.closest<HTMLElement>("[data-route]");
    if (button) {
      const detail =
        status.state === "notConfigured"
          ? t("rpc.notConfiguredDetail")
          : (status.detail ?? t("rpc.state." + status.state as TranslationKey));
      button.title = `${t("nav.rpc")} — ${detail}`;
    }
  }

  void syncMaximizeIcon();
  void appWindow.onResized(() => {
    void syncMaximizeIcon();
  });

  return { element: bar, setActive, setRpcStatus };
}