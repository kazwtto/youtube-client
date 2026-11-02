import { open } from "@tauri-apps/plugin-dialog";

import { icon } from "../components/icons";
import { t } from "../i18n";
import { api, type ExtensionSummary } from "../lib/api";
import { escapeHtml } from "../lib/html";

export async function renderExtensions(host: HTMLElement): Promise<void> {
  host.innerHTML = `
    <section class="page page--extensions">
      <header class="page__header page__header--row">
        <div>
          <h1>${t("extensions.title")}</h1>
          <p class="page__lead">${t("extensions.lead")}</p>
        </div>
        <button type="button" class="yt-button yt-button--tonal" id="extension-install">
          ${icon("plus", 18)}<span>${t("extensions.add")}</span>
        </button>
      </header>

      <div id="extensions-list" class="ext-list"></div>

      <p class="ext-snackbar" id="extensions-status" role="status" aria-live="polite" hidden></p>
    </section>

    <dialog class="yt-modal" id="extension-dialog" aria-labelledby="extension-dialog-title">
      <form method="dialog" class="yt-modal__body">
        <h2 class="yt-modal__title" id="extension-dialog-title">${t("extensions.add")}</h2>
        <p class="yt-modal__text">${t("extensions.addBody")}</p>
        <ul class="yt-modal__list">
          <li><code>manifest.json</code> — ${t("extensions.kindChromium")}</li>
          <li><code>ytapp.json</code> — ${t("extensions.kindNative")}</li>
        </ul>
        <div class="yt-modal__actions">
          <button type="button" class="yt-button yt-button--text" value="cancel" data-cancel>
            ${t("common.cancel")}
          </button>
          <button type="button" class="yt-button yt-button--filled" data-pick>
            ${icon("folder", 18)}<span>${t("extensions.pickFolder")}</span>
          </button>
        </div>
      </form>
    </dialog>
  `;

  const list = host.querySelector<HTMLElement>("#extensions-list")!;
  const snackbar = host.querySelector<HTMLElement>("#extensions-status")!;
  const installButton = host.querySelector<HTMLButtonElement>("#extension-install")!;
  const dialog = host.querySelector<HTMLDialogElement>("#extension-dialog")!;

  let installing = false;
  let snackTimer: number | undefined;

  function notify(message: string, tone: "idle" | "busy" | "error" = "idle"): void {
    if (snackTimer !== undefined) {
      window.clearTimeout(snackTimer);
    }

    snackbar.textContent = message;
    snackbar.dataset.tone = tone;
    snackbar.hidden = message === "";

    if (message !== "" && tone !== "busy") {
      snackTimer = window.setTimeout(() => {
        snackbar.hidden = true;
      }, 5000);
    }
  }

  function render(extensions: ExtensionSummary[]): void {
    list.replaceChildren();

    if (extensions.length === 0) {
      list.innerHTML = `
        <div class="yt-empty yt-empty--compact">
          ${icon("extensions", 22)}
          <p><strong>${t("extensions.empty")}</strong></p>
          <p>${t("extensions.emptyHint")}</p>
        </div>
      `;
      return;
    }

    for (const extension of extensions) {
      list.append(row(extension));
    }
  }

  function row(extension: ExtensionSummary): HTMLElement {
    const element = document.createElement("article");
    element.className = extension.enabled ? "extension-row" : "extension-row is-disabled";

    const kind = extension.hasChromiumManifest
      ? t("extensions.kindChromiumShort")
      : t("extensions.native");

    const permissions =
      extension.permissions.length > 0
        ? extension.permissions
            .map((permission) => `<span class="ext-chip">${escapeHtml(permission)}</span>`)
            .join("")
        : `<span class="extension-row__none">${t("extensions.noPermissions")}</span>`;

    const stateLabel = extension.enabled ? t("extensions.active") : t("extensions.inactive");

    element.innerHTML = `
      <div class="extension-row__icon" aria-hidden="true">${icon("extensions", 22)}</div>
      <div class="extension-row__body">
        <div class="extension-row__head">
          <h3>${escapeHtml(extension.name)}</h3>
          <span class="ext-badge">${escapeHtml(kind)}</span>
          <span class="ext-badge">v${escapeHtml(extension.version)}</span>
        </div>
        <p class="extension-row__desc">
          ${escapeHtml(extension.description ?? t("extensions.noDescription"))}
        </p>
        <div class="extension-row__permissions">
          ${permissions}
        </div>
      </div>
      <div class="extension-row__actions">
        <span class="ext-toggle">
          <span class="ext-toggle__label" data-state>${stateLabel}</span>
          <label class="yt-switch" title="${stateLabel}">
            <input
              type="checkbox"
              role="switch"
              data-toggle
              aria-label="${escapeHtml(extension.name)}"
              ${extension.enabled ? "checked" : ""}
            />
            <span class="yt-switch__track" aria-hidden="true"></span>
          </label>
        </span>
        <button
          type="button"
          class="yt-icon-button"
          data-remove
          title="${t("extensions.remove")}"
          aria-label="${t("extensions.remove")}"
        >${icon("trash", 18)}</button>
      </div>
    `;

    const toggle = element.querySelector<HTMLInputElement>("[data-toggle]")!;
    const state = element.querySelector<HTMLElement>("[data-state]")!;

    toggle.addEventListener("change", () => {
      void (async () => {
        const enabled = toggle.checked;
        toggle.disabled = true;
        state.textContent = enabled ? t("extensions.active") : t("extensions.inactive");
        element.classList.toggle("is-disabled", !enabled);
        notify(t("extensions.applying"), "busy");

        try {
          render(await api.extensionsSetEnabled(extension.id, enabled));
          notify(
            enabled
              ? t("extensions.enabled", { name: extension.name })
              : t("extensions.disabled", { name: extension.name }),
          );
        } catch (error) {
          toggle.checked = !enabled;
          element.classList.toggle("is-disabled", enabled);
          state.textContent = extension.enabled ? t("extensions.active") : t("extensions.inactive");
          notify(t("common.error", { error: String(error) }), "error");
        } finally {
          toggle.disabled = false;
        }
      })();
    });

    element.querySelector<HTMLButtonElement>("[data-remove]")?.addEventListener("click", () => {
      void (async () => {
        if (!window.confirm(t("extensions.confirmRemove", { name: extension.name }))) {
          return;
        }

        try {
          await api.extensionsUninstall(extension.id);
          notify(t("extensions.removed", { name: extension.name }));
          await refresh();
        } catch (error) {
          notify(t("common.error", { error: String(error) }), "error");
        }
      })();
    });

    return element;
  }

  async function refresh(): Promise<void> {
    try {
      render(await api.extensionsList());
    } catch (error) {
      list.textContent = t("extensions.loadError", { error: String(error) });
    }
  }

  async function install(): Promise<void> {
    if (installing) {
      return;
    }

    let source: string | null = null;
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("extensions.pickFolder"),
      });
      source = typeof selected === "string" ? selected : null;
    } catch (error) {
      notify(t("common.error", { error: String(error) }), "error");
      return;
    }

    if (!source) {
      return;
    }

    installing = true;
    installButton.disabled = true;
    notify(t("extensions.installing"), "busy");

    try {
      const installed = await api.extensionsInstall(source);
      await refresh();
      notify(t("extensions.installed", { name: installed.name }));
    } catch (error) {
      notify(t("common.error", { error: String(error) }), "error");
    } finally {
      installing = false;
      installButton.disabled = false;
    }
  }

  installButton.addEventListener("click", () => {
    dialog.showModal();
  });

  dialog.querySelector<HTMLButtonElement>("[data-cancel]")?.addEventListener("click", () => {
    dialog.close();
  });

  dialog.querySelector<HTMLButtonElement>("[data-pick]")?.addEventListener("click", () => {
    dialog.close();
    void install();
  });

  await refresh();
}
