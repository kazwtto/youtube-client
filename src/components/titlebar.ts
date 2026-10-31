import { getCurrentWindow } from "@tauri-apps/api/window";

import { t } from "../i18n";
import { api } from "../lib/api";

export interface TitlebarActions {
  onHome: () => void;
}

export function createTitlebar(actions: TitlebarActions): HTMLElement {
  const bar = document.createElement("header");
  bar.className = "titlebar";
  bar.dataset.tauriDragRegion = "";

  bar.innerHTML = `
    <div class="titlebar__brand" data-tauri-drag-region>
      <span class="titlebar__mark" aria-hidden="true">YT</span>
      <span class="titlebar__title">YT Desktop</span>
    </div>

    <div class="titlebar__nav" role="group" aria-label="${t("titlebar.youtubeNavigation")}">
      <button type="button" class="titlebar__button" data-action="back" title="${t("titlebar.back")}" aria-label="${t("titlebar.back")}">←</button>
      <button type="button" class="titlebar__button" data-action="forward" title="${t("titlebar.forward")}" aria-label="${t("titlebar.forward")}">→</button>
      <button type="button" class="titlebar__button" data-action="reload" title="${t("titlebar.reload")}" aria-label="${t("titlebar.reload")}">↻</button>
      <button type="button" class="titlebar__button" data-action="home" title="${t("titlebar.home")}" aria-label="${t("titlebar.home")}">⌂</button>
    </div>

    <div class="titlebar__spacer" data-tauri-drag-region></div>

    <div class="titlebar__controls" role="group" aria-label="${t("titlebar.windowControls")}">
      <button type="button" class="titlebar__button" data-action="minimize" title="${t("titlebar.minimize")}" aria-label="${t("titlebar.minimize")}">—</button>
      <button type="button" class="titlebar__button" data-action="toggle-maximize" title="${t("titlebar.maximize")}" aria-label="${t("titlebar.maximize")}">□</button>
      <button type="button" class="titlebar__button titlebar__button--close" data-action="close" title="${t("titlebar.close")}" aria-label="${t("titlebar.close")}">×</button>
    </div>
  `;

  const appWindow = getCurrentWindow();

  bar.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("[data-action]");
    if (!button) {
      return;
    }

    void handleAction(button.dataset.action);
  });

  async function handleAction(action: string | undefined): Promise<void> {
    switch (action) {
      case "back":
      case "forward":
      case "reload":
        await api.ytNavigate(action);
        break;

      case "home":
        actions.onHome();
        await api.ytNavigate("home");
        break;

      case "minimize":
        await appWindow.minimize();
        break;

      case "toggle-maximize":
        await appWindow.toggleMaximize();
        break;

      case "close":
        await appWindow.close();
        break;

      default:
        break;
    }
  }

  return bar;
}