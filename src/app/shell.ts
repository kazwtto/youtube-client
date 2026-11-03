import { listen } from "@tauri-apps/api/event";

import { createTitlebar } from "../components/titlebar";
import { onLanguageChange, t } from "../i18n";
import { api, type AppSettings, type AuthSnapshot, type RpcStatus } from "../lib/api";
import { renderExtensions } from "../pages/extensions";
import { renderHistory } from "../pages/history";
import { renderHome } from "../pages/home";
import { renderRpc } from "../pages/rpc";
import { renderSettings } from "../pages/settings";
import { Router, type RouteId } from "./router";

/// A page that has not loaded after this long is treated as a failure, which is
/// the only moment the retry action is offered.
const LOAD_FAILED_MS = 30_000;

export function createShell(root: HTMLElement): void {
  root.replaceChildren();

  const shell = document.createElement("div");
  shell.className = "shell";

  const content = document.createElement("main");
  content.className = "content";

  const loading = document.createElement("div");
  loading.className = "yt-loading";
  loading.hidden = true;
  loading.innerHTML = `
    <div class="yt-loading__inner" role="status" aria-live="polite">
      <span class="yt-loading__spinner" aria-hidden="true"></span>
      <p class="yt-loading__label" data-state="failed" hidden>${t("youtube.failed")}</p>
      <button type="button" class="yt-button yt-button--filled yt-loading__retry" hidden>
        ${t("youtube.retry")}
      </button>
    </div>
  `;

  const router = new Router(content);
  router
    .register({ id: "home", render: renderHome })
    .register({ id: "settings", render: renderSettings })
    .register({ id: "history", render: renderHistory })
    .register({ id: "extensions", render: renderExtensions })
    .register({ id: "rpc", render: renderRpc });

  const navigate = (id: RouteId): void => {
    void router.navigate(id).catch((error) => {
      console.error(t("shell.navigateError", { error: String(error) }));
    });
  };

  document.addEventListener("app:navigate", (event) => {
    if (event instanceof CustomEvent && typeof event.detail === "string") {
      navigate(event.detail as RouteId);
    }
  });

  const titlebar = createTitlebar({ onNavigate: navigate });

  shell.append(titlebar.element, content, loading);
  root.append(shell);

  let youtubeLoading = true;
  let slowTimer: number | undefined;
  let currentRoute: RouteId = "home";

  const label = loading.querySelector<HTMLElement>('[data-state="loading"]')!;
  const failed = loading.querySelector<HTMLElement>('[data-state="failed"]')!;
  const retry = loading.querySelector<HTMLButtonElement>(".yt-loading__retry")!;

  const syncLoading = (): void => {
    const visible = currentRoute === "home" && youtubeLoading;
    loading.hidden = !visible;

    if (slowTimer !== undefined) {
      window.clearTimeout(slowTimer);
      slowTimer = undefined;
    }

    if (!visible) {
      label.hidden = false;
      failed.hidden = true;
      retry.hidden = true;
      return;
    }

    // Only a load that never finishes offers a retry; a normal load just shows
    // the spinner until the page is ready.
    slowTimer = window.setTimeout(() => {
      label.hidden = true;
      failed.hidden = false;
      retry.hidden = false;
    }, LOAD_FAILED_MS);
  };

  retry.addEventListener("click", () => {
    youtubeLoading = true;
    syncLoading();
    void api.ytNavigate("reload");
  });

  void api
    .settingsGet()
    .then((settings: AppSettings) => {
      titlebar.setStyle(settings.general.titlebarStyle);
      titlebar.setMastheadIntegrated(settings.general.integrateMasthead);
    })
    .catch(() => undefined);

  void listen<AppSettings>("settings://changed", (event) => {
    titlebar.setStyle(event.payload.general.titlebarStyle);
    titlebar.setMastheadIntegrated(event.payload.general.integrateMasthead);
  }).catch(() => undefined);

  onLanguageChange(() => {
    titlebar.updateLanguage();
  });

  void listen<AuthSnapshot>("youtube://auth", (event) => {
    titlebar.setAuth(event.payload);
  }).catch(() => undefined);

  void listen<boolean>("youtube://loading", (event) => {
    youtubeLoading = event.payload;
    syncLoading();
  }).catch((error) => {
    console.warn(t("shell.loadingEventsError", { error: String(error) }));
  });

  router.onNavigate(async (route) => {
    currentRoute = route.id;
    titlebar.setActive(route.id);
    syncLoading();

    if (route.id === "home") {
      content.dataset.youtube = "true";
      void setYoutubeVisible(true);
      void api.ytNavigate("eval:(function(){ if (!location.hostname.includes('youtube.com')) { location.href = 'https://www.youtube.com'; } })()");
    } else {
      content.dataset.youtube = "false";
      void setYoutubeVisible(false);
    }
  });

  void api
    .rpcStatus()
    .then((status) => titlebar.setRpcStatus(status))
    .catch(() => undefined);

  void listen<RpcStatus>("rpc://status", (event) => {
    titlebar.setRpcStatus(event.payload);
  }).catch((error) => {
    console.warn(t("shell.rpcEventsError", { error: String(error) }));
  });

  titlebar.setActive(router.currentId);
  navigate("home");
}

/// Toggles the YouTube webview, retrying briefly because the UI webview can
/// invoke commands before the YouTube webview is registered during startup.
async function setYoutubeVisible(visible: boolean): Promise<void> {
  const maxAttempts = 6;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await api.setWebviewVisible("yt", visible);
      return;
    } catch (error) {
      if (attempt === maxAttempts - 1) {
        console.warn(t("shell.ytToggleError", { error: String(error) }));
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
  }
}
