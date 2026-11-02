import { open } from "@tauri-apps/plugin-dialog";

import { t } from "../i18n";
import { api, type ExtensionSummary } from "../lib/api";
import { escapeHtml } from "../lib/html";

const PUZZLE_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.44 7.85c-.05.32.06.65.29.88l1.57 1.57c.47.47.7 1.08.7 1.7s-.23 1.23-.7 1.7l-1.61 1.61a.98.98 0 0 1-.84.28c-.47-.07-.8-.48-.97-.93a2.5 2.5 0 1 0-3.21 3.21c.45.17.86.5.93.97a.98.98 0 0 1-.28.84l-1.61 1.61a2.4 2.4 0 0 1-1.7.71 2.4 2.4 0 0 1-1.7-.71l-1.57-1.57a1.03 1.03 0 0 0-.88-.29c-.49.07-.84.5-1.02.97a2.5 2.5 0 1 1-3.24-3.24c.47-.18.9-.53.97-1.02a1.03 1.03 0 0 0-.29-.88L2.7 13.7a2.4 2.4 0 0 1-.7-1.7c0-.62.24-1.23.7-1.7L4.23 8.77c.24-.24.58-.35.92-.3.51.08.88.53 1.07 1.01a2.5 2.5 0 1 0 3.26-3.26c-.48-.19-.93-.56-1.01-1.07-.05-.34.06-.68.3-.92L10.3 2.7a2.4 2.4 0 0 1 1.7-.7c.62 0 1.23.24 1.7.7l1.57 1.57c.23.23.56.34.88.29.49-.07.84-.5 1.02-.97a2.5 2.5 0 1 1 3.24 3.24c-.47.18-.9.53-.97 1.02Z"/>`;
const TRASH_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></svg>`;
const PLUS_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`;
const FOLDER_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.4h9A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z"/></svg>`;

export async function renderExtensions(host: HTMLElement): Promise<void> {
  host.innerHTML = `
    <section class="page page--extensions">
      <header class="page__header page__header--row">
        <div>
          <h1>${t("extensions.title")}</h1>
          <p class="page__lead">${t("extensions.lead")}</p>
        </div>
        <button type="button" class="yt-button yt-button--tonal" id="extension-install">
          ${PLUS_ICON}<span>${t("extensions.add")}</span>
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
            ${FOLDER_ICON}<span>${t("extensions.pickFolder")}</span>
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
          ${PUZZLE_ICON}
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
      <div class="extension-row__icon" aria-hidden="true">${PUZZLE_ICON}</div>
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
        >${TRASH_ICON}</button>
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
