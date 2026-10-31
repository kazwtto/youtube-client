import { listen } from "@tauri-apps/api/event";

import { createTitlebar } from "../components/titlebar";
import { renderSidebar } from "../components/sidebar";
import { t, type TranslationKey } from "../i18n";
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

  const workspace = document.createElement("div");
  workspace.className = "workspace";

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";

  const navHost = document.createElement("div");
  navHost.className = "sidebar__nav-host";

  const footer = document.createElement("div");
  footer.className = "sidebar__footer";
  footer.innerHTML = `
    <span class="status-dot" data-rpc-state="disabled"></span>
    <span data-rpc-label>${t("shell.discord", { state: t("rpc.status.disabled") })}</span>
  `;

  sidebar.append(navHost, footer);

  const content = document.createElement("main");
  content.className = "content";

  workspace.append(sidebar, content);

  const router = new Router(content);
  router
    .register({ id: "home", label: t("nav.home"), icon: "▶", render: renderHome })
    .register({
      id: "settings",
      label: t("nav.settings"),
      icon: "⚙",
      render: renderSettings,
    })
    .register({
      id: "history",
      label: t("nav.history"),
      icon: "◷",
      render: renderHistory,
    })
    .register({
      id: "extensions",
      label: t("nav.extensions"),
      icon: "◧",
      render: renderExtensions,
    })
    .register({ id: "rpc", label: t("nav.rpc"), icon: "◎", render: renderRpc });

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

  const titlebar = createTitlebar({
    onHome: () => {
      navigate("home");
    },
  });

  shell.append(titlebar, workspace);
  root.append(shell);

  const renderNav = (current: RouteId): void => {
    renderSidebar(navHost, router.definitions, current, navigate);
  };

  router.onNavigate(async (route) => {
    renderNav(route.id);

    try {
      await api.setWebviewVisible("yt", route.id === "home");
    } catch (error) {
      console.warn(t("shell.ytToggleError", { error: String(error) }));
    }
  });

  void api
    .rpcStatus()
    .then((status) => updateRpcPill(footer, status))
    .catch(() => undefined);

  void listen<RpcStatus>("rpc://status", (event) => {
    updateRpcPill(footer, event.payload);
  }).catch((error) => {
    console.warn(t("shell.rpcEventsError", { error: String(error) }));
  });

  renderNav(router.currentId);
  navigate("home");
}

function updateRpcPill(footer: HTMLElement, status: RpcStatus): void {
  const dot = footer.querySelector<HTMLElement>("[data-rpc-state]");
  const label = footer.querySelector<HTMLElement>("[data-rpc-label]");

  if (!dot || !label) {
    return;
  }

  dot.dataset.rpcState = status.state;
  label.textContent = t("shell.discord", { state: t(rpcStateKey(status.state)) });
  footer.title = status.detail ?? "";
}

function rpcStateKey(state: string): TranslationKey {
  switch (state) {
    case "connected":
      return "rpc.status.connected";
    case "connecting":
      return "rpc.status.connecting";
    case "idle":
      return "rpc.status.idle";
    case "notConfigured":
      return "rpc.status.notConfigured";
    case "error":
      return "rpc.status.error";
    default:
      return "rpc.status.disabled";
  }
}