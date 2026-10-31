import { t } from "../i18n";
import { api } from "../lib/api";
import { escapeHtml } from "../lib/html";

export async function renderRpc(host: HTMLElement): Promise<void> {
  const [status, settings] = await Promise.all([api.rpcStatus(), api.settingsGet()]);

  const detail =
    status.state === "notConfigured"
      ? t("rpc.notConfiguredDetail")
      : (status.detail ?? t("rpc.noDetail"));

  host.innerHTML = `
    <section class="page">
      <header class="page__header">
        <p class="eyebrow">${t("rpc.eyebrow")}</p>
        <h1>${t("rpc.title")}</h1>
        <p class="page__lead">${t("rpc.lead")}</p>
      </header>

      <div class="card">
        <div class="status-row">
          <span class="status-dot" data-state="${escapeHtml(status.state)}"></span>
          <div>
            <h2>${escapeHtml(rpcLabel(status.state))}</h2>
            <p class="muted">${escapeHtml(detail)}</p>
          </div>
        </div>

        <p class="muted">
          ${t("rpc.applicationId")}
          ${settings.rpc.appId ? escapeHtml(settings.rpc.appId) : t("rpc.notConfigured")}
        </p>

        <div class="toolbar">
          <button type="button" class="button button--primary" id="rpc-settings">
            ${t("rpc.openSettings")}
          </button>
        </div>
      </div>

      <div class="card">
        <h2>${t("rpc.howItWorks")}</h2>
        <p>${t("rpc.howItWorksBody")}</p>
        <p>${t("rpc.setupBody")}</p>
      </div>
    </section>
  `;

  host
    .querySelector<HTMLButtonElement>("#rpc-settings")
    ?.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("app:navigate", { detail: "settings" }));
    });
}

function rpcLabel(state: string): string {
  switch (state) {
    case "connected":
      return t("rpc.state.connected");
    case "connecting":
      return t("rpc.state.connecting");
    case "idle":
      return t("rpc.state.idle");
    case "notConfigured":
      return t("rpc.state.notConfigured");
    case "error":
      return t("rpc.state.error");
    default:
      return t("rpc.state.disabled");
  }
}