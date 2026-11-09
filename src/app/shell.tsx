import { listen } from "@tauri-apps/api/event";
import { createSignal, type Accessor } from "solid-js";
import { render } from "solid-js/web";

import { createTitlebar } from "../components/titlebar";
import { renderBrowserImportDialog } from "./browser-import-dialog";
import { t } from "../i18n";
import { api, type AppSettings, type AuthSnapshot, type RpcStatus, type YoutubeTitlebarIcons } from "../lib/api";
import { renderExtensions } from "../pages/extensions";
import { renderHistory } from "../pages/history";
import { renderHome } from "../pages/home";
import { renderRpc } from "../pages/rpc";
import { renderSettings } from "../pages/settings";
import { Router, type RouteId } from "./router";

/// A page that has not loaded after this long is treated as a failure, which is
/// the only moment the retry action is offered.
const LOAD_FAILED_MS = 30_000;

async function animateContentOutForYoutube(content: HTMLElement): Promise<void> {
  if (
    document.documentElement.dataset.motion === "off" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  content.classList.remove("content--youtube-exit");
  void content.offsetWidth;
  content.classList.add("content--youtube-exit");
  const animations = content.getAnimations();
  const animation = animations[animations.length - 1];
  if (animation) await animation.finished.catch(() => undefined);
}

function LoadingOverlay(props: { failed: Accessor<boolean>; retry: () => void }) {
  return (
    <div class="yt-loading__inner" role="status" aria-live="polite">
      <span class="yt-loading__spinner" aria-hidden="true" />
      <p class="yt-loading__label" hidden={props.failed()} style={{ display: 'none' }}>{t("youtube.loading")}</p>
      <p class="yt-loading__label" hidden={!props.failed()}>{t("youtube.failed")}</p>
      <button type="button" class="yt-button yt-button--filled yt-loading__retry" hidden={!props.failed()} onClick={props.retry}>
        {t("youtube.retry")}
      </button>
    </div>
  );
}

export function createShell(root: HTMLElement): void {
  root.replaceChildren();

  const shell = document.createElement("div");
  shell.className = "shell";

  const content = document.createElement("main");
  content.className = "content";

  const loading = document.createElement("div");
  loading.className = "yt-loading";
  loading.hidden = true;
  const [loadingFailed, setLoadingFailed] = createSignal(false);

  const router = new Router(content);
  router
    .register({ id: "home", render: renderHome, preservePreviousUntilActivated: true })
    .register({ id: "settings", render: renderSettings })
    .register({ id: "history", render: renderHistory })
    .register({ id: "extensions", render: renderExtensions })
    .register({ id: "rpc", render: renderRpc });

  const navigate = (id: RouteId): void => {
    if (router.definitions.some((route) => route.id === id)) titlebar.setActive(id);
    void router.navigate(id).catch((error) => {
      console.error(t("shell.navigateError", { error: String(error) }));
    });
  };

  document.addEventListener("app:navigate", (event) => {
    if (event instanceof CustomEvent && typeof event.detail === "string") {
      navigate(event.detail as RouteId);
    }
  });

  const titlebar = createTitlebar({ onNavigate: navigate, onRefreshAuth: () => refreshAuth() });

  shell.append(titlebar.element, content, loading);
  const browserImportHost = document.createElement("div");
  browserImportHost.className = "browser-import-host";
  root.append(shell, browserImportHost);
  renderBrowserImportDialog(browserImportHost);

  let youtubeLoading = true;
  let slowTimer: number | undefined;
  let currentRoute: RouteId = "home";

  const syncLoading = (): void => {
    const visible = currentRoute === "home" && youtubeLoading;
    loading.hidden = !visible;

    if (slowTimer !== undefined) {
      window.clearTimeout(slowTimer);
      slowTimer = undefined;
    }

    if (!visible) {
      setLoadingFailed(false);
      return;
    }

    // Only a load that never finishes offers a retry; a normal load just shows
    // the spinner until the page is ready.
    slowTimer = window.setTimeout(() => {
      setLoadingFailed(true);
    }, LOAD_FAILED_MS);
  };

  // The app window is shown as soon as createShell returns. Keep that first
  // frame opaque instead of waiting for the async home route to finish.
  syncLoading();

  render(() => <LoadingOverlay
    failed={loadingFailed}
    retry={() => {
      youtubeLoading = true;
      syncLoading();
      void api.ytNavigate("reload");
    }}
  />, loading);

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

  let authFallbackTimer: number | undefined;
  let authRetryTimer: number | undefined;
  let authReceived = false;
  let authListener: Promise<void> | undefined;
  const stopAuthTimers = (): void => {
    window.clearTimeout(authFallbackTimer);
    window.clearInterval(authRetryTimer);
    authFallbackTimer = authRetryTimer = undefined;
  };
  const refreshAuth = (): void => {
    stopAuthTimers();
    authReceived = false;
    titlebar.setAuthLoading();
    const request = (): void => { void api.requestAuthSnapshot().catch(() => undefined); };
    authRetryTimer = window.setInterval(request, 1000);
    authFallbackTimer = window.setTimeout(() => {
      stopAuthTimers();
      titlebar.setAuthUnavailable();
    }, 10_000);
    subscribeAuth();
    request();
  };
  const subscribeAuth = (): void => {
    if (authListener) return;
    authListener = listen<AuthSnapshot>("youtube://auth", (event) => {
      authReceived = true;
      stopAuthTimers();
      titlebar.setAuth(event.payload);
    }).then(() => {
      if (!authReceived) void api.requestAuthSnapshot().catch(() => undefined);
    }).catch(() => {
      authListener = undefined;
      stopAuthTimers();
      titlebar.setAuthUnavailable();
    });
  };
  refreshAuth();

  void listen<YoutubeTitlebarIcons>("youtube://titlebar-icons", (event) => {
    titlebar.setYoutubeIcons(event.payload);
  }).then(() => api.requestYoutubeTitlebarIcons()).catch(() => undefined);

  let loadingEventVersion = 0;
  const applyYoutubeLoading = async (loading: boolean, version: number): Promise<void> => {
    // Keep the opaque launcher above YouTube until its first visible frame is
    // confirmed. Lower it before hiding the cover, after that frame exists.
    if (currentRoute === "home") {
      await api.setLauncherRouteActive(loading).catch(() => undefined);
    }
    if (version !== loadingEventVersion) return;
    youtubeLoading = loading;
    syncLoading();
  };

  void listen<boolean>("youtube://loading", (event) => {
    const version = ++loadingEventVersion;
    void applyYoutubeLoading(event.payload, version);
  }).then(async () => {
    const version = loadingEventVersion;
    try {
      const loadingState = await api.youtubeLoadingState();
      if (version === loadingEventVersion) {
        await applyYoutubeLoading(loadingState, version);
      }
    } catch {
      // The event listener remains the source of updates if reconciliation fails.
    }
  }).catch((error) => {
    console.warn(t("shell.loadingEventsError", { error: String(error) }));
  });

  let routeUpdate = 0;
  router.onNavigate(async (route) => {
    const update = ++routeUpdate;
    const returningToYoutube = currentRoute !== "home" && route.id === "home";
    currentRoute = route.id;
    syncLoading();

    if (route.id === "home") {
      // Reveal the already-running YouTube surface by fading the launcher away.
      if (returningToYoutube && !youtubeLoading) {
        await animateContentOutForYoutube(content);
      }
      if (update !== routeUpdate) {
        content.classList.remove("content--youtube-exit");
        return;
      }

      content.dataset.youtube = "true";
      content.classList.remove("content--youtube-exit");
      await api.setLauncherRouteActive(youtubeLoading).catch(() => undefined);
      if (update !== routeUpdate) {
        if (router.currentId !== "home") {
          await api.setLauncherRouteActive(true).catch(() => undefined);
        }
        return;
      }

      if (!returningToYoutube) await setYoutubeVisible(true);
      void api.ytNavigate(
        "eval:if (!location.hostname.includes('youtube.com')) location.href = 'https://www.youtube.com'",
      );
    } else {
      content.classList.remove("content--youtube-exit");
      content.dataset.youtube = "false";
      // Leave YouTube rendered underneath; only change which native WebView is in front.
      await api.setLauncherRouteActive(true).catch(() => undefined);
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
async function setYoutubeVisible(visible: boolean): Promise<boolean> {
  const maxAttempts = 6;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await api.setWebviewVisible("yt", visible);
      return true;
    } catch (error) {
      if (attempt === maxAttempts - 1) {
        console.warn(t("shell.ytToggleError", { error: String(error) }));
        return false;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
  }

  return false;
}
