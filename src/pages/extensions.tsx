import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { createStore, reconcile } from "solid-js/store";

import { Icon } from "../components/icons";
import { t } from "../i18n";
import { api, type ExtensionSummary } from "../lib/api";

interface ExtensionsPageProps {
  host: HTMLElement;
}

function ExtensionCard(props: {
  extension: ExtensionSummary;
  pending: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (extension: ExtensionSummary) => void;
}) {
  const [enabled, setEnabled] = createSignal(props.extension.enabled);
  createEffect(() => setEnabled(props.extension.enabled));
  const stateLabel = (): string => t(enabled() ? "extensions.active" : "extensions.inactive");

  return (
    <article class="extension-row" classList={{ "is-disabled": !enabled() }}>
      <div class="extension-row__icon" aria-hidden="true"><Icon name="extensions" size={22} /></div>
      <div class="extension-row__body">
        <div class="extension-row__head">
          <h3>{props.extension.name}</h3>
          <span class="ext-badge">{t(props.extension.hasChromiumManifest ? "extensions.kindChromiumShort" : "extensions.native")}</span>
          <span class="ext-badge">v{props.extension.version}</span>
        </div>
        <p class="extension-row__desc">{props.extension.description ?? t("extensions.noDescription")}</p>
        <div class="extension-row__permissions">
          <Show when={props.extension.permissions.length > 0} fallback={<span class="extension-row__none">{t("extensions.noPermissions")}</span>}>
            <For each={props.extension.permissions}>{(permission) => <span class="ext-chip">{permission}</span>}</For>
          </Show>
        </div>
      </div>
      <div class="extension-row__actions">
        <span class="ext-toggle">
          <span class="ext-toggle__label">{stateLabel()}</span>
          <label class="yt-switch" title={stateLabel()}>
            <input
              type="checkbox"
              role="switch"
              checked={enabled()}
              disabled={props.pending}
              aria-label={`${props.extension.name}: ${stateLabel()}`}
              onChange={(event) => {
                const next = event.currentTarget.checked;
                setEnabled(next);
                props.onToggle(props.extension.id, next);
              }}
            />
            <span class="yt-switch__track" aria-hidden="true" />
          </label>
        </span>
        <button type="button" class="yt-icon-button" title={t("extensions.remove")} aria-label={`${t("extensions.remove")} ${props.extension.name}`} onClick={() => props.onRemove(props.extension)}>
          <Icon name="trash" size={18} />
        </button>
      </div>
    </article>
  );
}

function ExtensionsPage(props: ExtensionsPageProps) {
  const [extensions, setExtensions] = createStore<ExtensionSummary[]>([]);
  const [status, setStatus] = createSignal("");
  const [tone, setTone] = createSignal<"idle" | "busy" | "error">("idle");
  const [installing, setInstalling] = createSignal(false);
  const [dropActive, setDropActive] = createSignal(false);
  const [pendingIds, setPendingIds] = createSignal(new Set<string>());
  const [loadError, setLoadError] = createSignal("");
  let dialog!: HTMLDialogElement;
  let snackTimer: number | undefined;
  let refreshRequest = 0;
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];

  const notify = (message: string, kind: "idle" | "busy" | "error" = "idle"): void => {
    if (snackTimer !== undefined) window.clearTimeout(snackTimer);
    setStatus(message);
    setTone(kind);
    if (message && kind !== "busy") snackTimer = window.setTimeout(() => setStatus(""), 5000);
  };

  const refresh = async (): Promise<void> => {
    const request = ++refreshRequest;
    try {
      setLoadError("");
      const latest = await api.extensionsList();
      if (request !== refreshRequest) return;
      setExtensions(reconcile(latest, { key: "id" }));
    } catch (error) {
      if (request === refreshRequest) setLoadError(t("extensions.loadError", { error: String(error) }));
    }
  };

  const install = async (): Promise<void> => {
    if (installing()) return;
    let source: string | null = null;
    try {
      const selected = await open({ directory: true, multiple: false, title: t("extensions.pickFolder") });
      source = typeof selected === "string" ? selected : null;
    } catch (error) {
      notify(t("common.error", { error: String(error) }), "error");
      return;
    }
    if (!source) return;

    setInstalling(true);
    notify(t("extensions.installing"), "busy");
    try {
      const installed = await api.extensionsInstall(source);
      await refresh();
      notify(installed.length ? t("extensions.installedCount", { count: installed.length }) : t("extensions.noneInstalled"), installed.length ? "idle" : "error");
    } catch (error) {
      notify(t("common.error", { error: String(error) }), "error");
    } finally {
      setInstalling(false);
    }
  };

  const installFiles = async (paths: string[]): Promise<void> => {
    if (!paths.length || installing()) return;
    setInstalling(true);
    notify(t("extensions.installing"), "busy");
    let totalInstalled = 0;
    const errors: string[] = [];
    for (const path of paths) {
      try {
        totalInstalled += (await api.extensionsInstall(path)).length;
      } catch (error) {
        errors.push(`${path}: ${String(error)}`);
      }
    }
    await refresh();
    setInstalling(false);
    if (totalInstalled > 0 && errors.length > 0) {
      notify(t("extensions.partialInstall", { count: totalInstalled, errors: errors.slice(0, 3).join("; ") }), "error");
    } else if (totalInstalled > 0) {
      notify(t("extensions.installedCount", { count: totalInstalled }));
    } else if (errors.length > 0) {
      notify(errors.slice(0, 3).join("; "), "error");
    } else {
      notify(t("extensions.noneInstalled"), "error");
    }
  };

  const toggle = async (id: string, enabled: boolean): Promise<void> => {
    setPendingIds((current) => new Set(current).add(id));
    notify(t("extensions.applying"), "busy");
    try {
      await api.extensionsSetEnabled(id, enabled).then((items) => setExtensions(reconcile(items, { key: "id" })));
      const extension = extensions.find((item) => item.id === id);
      notify(enabled
        ? t("extensions.enabled", { name: extension?.name ?? id })
        : t("extensions.disabled", { name: extension?.name ?? id }));
    } catch (error) {
      notify(t("common.error", { error: String(error) }), "error");
      await refresh();
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const remove = async (extension: ExtensionSummary): Promise<void> => {
    if (!window.confirm(t("extensions.confirmRemove", { name: extension.name }))) return;
    try {
      await api.extensionsUninstall(extension.id);
      notify(t("extensions.removed", { name: extension.name }));
      await refresh();
    } catch (error) {
      notify(t("common.error", { error: String(error) }), "error");
    }
  };

  onMount(() => {
    const activate = (): void => void refresh();
    const onDragOver = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      setDropActive(true);
    };
    const onDragLeave = (event: DragEvent): void => {
      if (event.target === event.currentTarget || event.relatedTarget === null) setDropActive(false);
    };
    props.host.addEventListener("page:activated", activate);
    props.host.addEventListener("dragover", onDragOver);
    props.host.addEventListener("dragleave", onDragLeave);

    const register = (promise: Promise<UnlistenFn>): void => {
      void promise.then((stop) => {
        if (disposed) stop();
        else unlisteners.push(stop);
      }).catch(() => undefined);
    };
    register(listen("extensions://changed", () => void refresh()));
    try {
      register(getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") setDropActive(true);
        else if (event.payload.type === "leave") setDropActive(false);
        else if (event.payload.type === "drop") {
          setDropActive(false);
          const paths = event.payload.paths;
          if (Array.isArray(paths)) void installFiles(paths);
        }
      }));
    } catch {
      // The file picker remains available when native drag and drop is unavailable.
    }
    void refresh();

    onCleanup(() => {
      props.host.removeEventListener("page:activated", activate);
      props.host.removeEventListener("dragover", onDragOver);
      props.host.removeEventListener("dragleave", onDragLeave);
    });
  });

  onCleanup(() => {
    disposed = true;
    for (const stop of unlisteners) stop();
    if (snackTimer !== undefined) window.clearTimeout(snackTimer);
  });

  return (
    <>
      <section class="page page--extensions">
        <header class="page__header page__header--row">
          <div>
            <h1>{t("extensions.title")}</h1>
            <p class="page__lead">{t("extensions.lead")}</p>
          </div>
          <button type="button" class="yt-button yt-button--tonal" disabled={installing()} onClick={() => dialog.showModal()}>
            <Icon name="plus" size={18} /><span>{t("extensions.add")}</span>
          </button>
        </header>

        <div class="ext-list">
          <Show when={!loadError()} fallback={<p class="status" role="status">{loadError()}</p>}>
            <Show when={extensions.length > 0} fallback={
              <div class="yt-empty yt-empty--compact">
                <Icon name="extensions" size={22} />
                <p><strong>{t("extensions.empty")}</strong></p>
                <p>{t("extensions.emptyHint")}</p>
              </div>
            }>
              <For each={extensions}>
                {(extension) => <ExtensionCard extension={extension} pending={pendingIds().has(extension.id)} onToggle={toggle} onRemove={remove} />}
              </For>
            </Show>
          </Show>
        </div>

        <div class="ext-dropzone-overlay" hidden={!dropActive()}>
          <Icon name="folder" size={36} />
          <span>{t("extensions.dropzone")}</span>
        </div>
        <p class="ext-snackbar" data-tone={tone()} role="status" aria-live="polite" hidden={!status()}>{status()}</p>
      </section>

      <dialog class="yt-modal" aria-labelledby="extension-dialog-title" ref={dialog}>
        <form method="dialog" class="yt-modal__body">
          <h2 class="yt-modal__title" id="extension-dialog-title">{t("extensions.add")}</h2>
          <p class="yt-modal__text">{t("extensions.addBody")}</p>
          <ul class="yt-modal__list">
            <li><code>manifest.json</code> — {t("extensions.kindChromium")}</li>
            <li><code>ytapp.json</code> — {t("extensions.kindNative")}</li>
          </ul>
          <div class="yt-modal__actions">
            <button type="button" class="yt-button yt-button--text" onClick={() => dialog.close()}>{t("common.cancel")}</button>
            <button type="button" class="yt-button yt-button--filled" disabled={installing()} onClick={() => { dialog.close(); void install(); }}>
              <Icon name="folder" size={18} /><span>{t("extensions.pickFolder")}</span>
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function renderExtensions(host: HTMLElement): void {
  render(() => <ExtensionsPage host={host} />, host);
}
