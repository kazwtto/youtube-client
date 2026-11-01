import { listen } from "@tauri-apps/api/event";

import { createTitlebar } from "../components/titlebar";
import { t } from "../i18n";
import { api, type RpcStatus } from "../lib/api";
import { renderExtensions } from "../pages/extensions";
import { renderHistory } from "../pages/history";
import { renderHome } from "../pages/home";
import { renderRpc } from "../pages/rpc";
import { renderSettings } from "../pages/settings";
import { Router, type RouteId } from "./router";

export function createShell(root: HTMLElement): void {
  root.replaceChildren();

  const shell = document.createElement("div");
  shell.className = "shell";

  const content = document.createElement("main");
  content.className = "content";

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

  shell.append(titlebar.element, content);
  root.append(shell);

  router.onNavigate(async (route) => {
    titlebar.setActive(route.id);
    await setYoutubeVisible(route.id === "home");
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
