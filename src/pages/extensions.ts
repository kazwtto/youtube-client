import { t } from "../i18n";
import { api, type ExtensionSummary } from "../lib/api";
import { escapeHtml } from "../lib/html";

export async function renderExtensions(host: HTMLElement): Promise<void> {
  host.innerHTML = `
    <section class="page">
      <header class="page__header">
        <p class="eyebrow">${t("extensions.eyebrow")}</p>
        <h1>${t("extensions.title")}</h1>
        <p class="page__lead">${t("extensions.lead")}</p>
      </header>

      <section class="card">
        <div class="card__header">
          <h2>${t("extensions.installTitle")}</h2>
          <p class="muted">
            ${t("extensions.installHint")}
          </p>
        </div>

        <div class="toolbar">
          <input
            type="text"
            id="extension-path"
            class="text-input"
            placeholder="${t("extensions.pathPlaceholder")}"
          />
          <button type="button" class="button button--primary" id="extension-install">
            ${t("extensions.install")}
          </button>
        </div>
      </section>

      <div id="extensions-list"></div>
      <p class="status" id="extensions-status" role="status"></p>
    </section>
  `;

  const list = host.querySelector<HTMLElement>("#extensions-list")!;
  const status = host.querySelector<HTMLElement>("#extensions-status")!;
  const input = host.querySelector<HTMLInputElement>("#extension-path")!;
  const installButton = host.querySelector<HTMLButtonElement>("#extension-install")!;

  async function refresh(): Promise<void> {
    try {
      const extensions = await api.extensionsList();
      list.replaceChildren();

      if (extensions.length === 0) {
        list.innerHTML = `<div class="empty">${t("extensions.empty")}</div>`;
        return;
      }

      const grid = document.createElement("div");
      grid.className = "card-grid";

      for (const extension of extensions) {
        grid.append(extensionCard(extension, refresh, status));
      }

      list.append(grid);
    } catch (error) {
      list.textContent = t("extensions.loadError", { error: String(error) });
    }
  }

  installButton.addEventListener("click", () => {
    const source = input.value.trim();
    if (!source) {
      status.textContent = t("extensions.providePath");
      return;
    }

    void (async () => {
      try {
        status.textContent = t("extensions.installing");
        const installed = await api.extensionsInstall(source);
        status.textContent = t("extensions.installed", { name: installed.name });
        input.value = "";
        await refresh();
      } catch (error) {
        status.textContent = t("common.error", { error: String(error) });
      }
    })();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      installButton.click();
    }
  });

  await refresh();
}

function extensionCard(
  extension: ExtensionSummary,
  refresh: () => Promise<void>,
  status: HTMLElement,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "card extension";

  const permissions =
    extension.permissions.length > 0
      ? extension.permissions.join(" · ")
      : t("extensions.noPermissions");

  card.innerHTML = `
    <div class="extension__head">
      <div>
        <h2>${escapeHtml(extension.name)}</h2>
        <p class="muted">
          v${escapeHtml(extension.version)} ·
          ${extension.hasChromiumManifest ? "Chromium" : t("extensions.native")}
        </p>
      </div>
      <span class="badge ${extension.enabled ? "badge--on" : "badge--off"}">
        ${extension.enabled ? t("extensions.active") : t("extensions.inactive")}
      </span>
    </div>
    <p>${escapeHtml(extension.description ?? t("extensions.noDescription"))}</p>
    <p class="muted">${t("extensions.permissions", { permissions: escapeHtml(permissions) })}</p>
    <div class="extension__actions">
      <button type="button" class="button" data-toggle>
        ${extension.enabled ? t("extensions.disable") : t("extensions.enable")}
      </button>
      <button type="button" class="button button--danger" data-remove>${t("extensions.remove")}</button>
    </div>
  `;

  card
    .querySelector<HTMLButtonElement>("[data-toggle]")
    ?.addEventListener("click", () => {
      void (async () => {
        try {
          status.textContent = t("extensions.applying");
          await api.extensionsSetEnabled(extension.id, !extension.enabled);
          await refresh();
          status.textContent = "";
        } catch (error) {
          status.textContent = t("common.error", { error: String(error) });
        }
      })();
    });

  card
    .querySelector<HTMLButtonElement>("[data-remove]")
    ?.addEventListener("click", () => {
      void (async () => {
        if (!window.confirm(t("extensions.confirmRemove", { name: extension.name }))) {
          return;
        }

        try {
          await api.extensionsUninstall(extension.id);
          status.textContent = t("extensions.removed", { name: extension.name });
          await refresh();
        } catch (error) {
          status.textContent = t("common.error", { error: String(error) });
        }
      })();
    });

  return card;
}