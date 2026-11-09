import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Portal, render } from "solid-js/web";

import { t } from "../i18n";
import { api, type BrowserDataSource } from "../lib/api";

const FIRST_RUN_PROMPT_KEY = "yt_browser_import_prompted_v2";

function wasPrompted(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_PROMPT_KEY) === "1";
  } catch {
    return true;
  }
}

function markPrompted(): void {
  try {
    localStorage.setItem(FIRST_RUN_PROMPT_KEY, "1");
  } catch {
    // The import can still be started manually when storage is unavailable.
  }
}

function BrowserImportDialog() {
  const [open, setOpen] = createSignal(false);
  const [sources, setSources] = createSignal<BrowserDataSource[]>([]);
  const [selectedBrowser, setSelectedBrowser] = createSignal("");
  const [importAccount, setImportAccount] = createSignal(true);
  const [importHistory, setImportHistory] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [complete, setComplete] = createSignal(false);
  const [status, setStatus] = createSignal("");
  let operation = 0;
  let dialog!: HTMLDialogElement;
  let openingTrigger: HTMLElement | null = null;
  let restoreYoutubeOnClose = false;
  let markFirstLaunchPromptOnClose = false;

  const selectedSource = () => sources().find((source) => source.id === selectedBrowser());

  const setYoutubeVisible = async (visible: boolean): Promise<boolean> => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await api.setWebviewVisible("yt", visible);
        return true;
      } catch (error) {
        if (attempt === 5) {
          console.error(error);
          return false;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
    }
    return false;
  };

  const showDialog = async (
    found: BrowserDataSource[],
    error = false,
    hideYoutube = false,
    firstLaunchPrompt = false,
  ): Promise<void> => {
    if (hideYoutube) {
      restoreYoutubeOnClose = await setYoutubeVisible(false);
    }
    const preferred = found.find((source) => source.isDefault) ?? found[0];
    setSources(found);
    setSelectedBrowser(preferred?.id ?? "");
    setImportAccount(true);
    setImportHistory(preferred?.hasYoutubeHistory ?? false);
    setComplete(false);
    setStatus(error ? t("settings.browserDetectFailed") : "");
    markFirstLaunchPromptOnClose = firstLaunchPrompt && !error;
    setOpen(true);
    requestAnimationFrame(() => {
      if (!open()) return;
      if (!dialog.open) dialog.showModal();
      dialog.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus();
    });
  };

  const detectAndShow = async (firstLaunch = false): Promise<void> => {
    try {
      const found = await api.browserDataSources();
      if (firstLaunch) {
        if (wasPrompted()) return;
        if (found.length === 0) return;
      }
      await showDialog(found, false, firstLaunch, firstLaunch);
    } catch (error) {
      console.error(error);
      await showDialog([], true, firstLaunch, firstLaunch);
    }
  };

  const close = (): void => {
    if (!open()) return;
    operation += 1;
    setBusy(false);
    if (dialog.open) dialog.close();
    setOpen(false);
    openingTrigger?.focus();
    openingTrigger = null;
    if (markFirstLaunchPromptOnClose) {
      markPrompted();
      markFirstLaunchPromptOnClose = false;
    }
    if (restoreYoutubeOnClose) {
      restoreYoutubeOnClose = false;
      void setYoutubeVisible(true);
    }
  };

  const importSelected = async (): Promise<void> => {
    if (busy() || complete()) {
      if (complete()) close();
      return;
    }
    const currentOperation = ++operation;
    setBusy(true);
    setStatus("");
    let historyImported = false;
    try {
      if (importHistory()) {
        const result = await api.browserHistoryImport(selectedBrowser());
        if (currentOperation !== operation) return;
        historyImported = true;
        setStatus(result.imported > 0
          ? t("settings.browserImportDone", { count: result.imported, browser: result.browserName })
          : t("settings.browserImportEmpty", { browser: result.browserName }));
      }

      if (importAccount()) {
        await api.openAuthModal();
        if (currentOperation === operation) close();
      } else {
        setComplete(true);
      }
    } catch (error) {
      console.error(error);
      if (currentOperation === operation) {
        setStatus(importHistory() && !historyImported
          ? t("settings.browserImportFailed")
          : t("settings.browserLoginFailed"));
      }
    } finally {
      if (currentOperation === operation) setBusy(false);
    }
  };

  onMount(() => {
    const onImportRequest = (): void => {
      openingTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      void detectAndShow();
    };
    document.addEventListener("app:browser-import", onImportRequest);
    if (!wasPrompted()) void detectAndShow(true);
    onCleanup(() => {
      operation += 1;
      document.removeEventListener("app:browser-import", onImportRequest);
    });
  });

  return (
    <Show when={open()}>
      <Portal>
        <dialog
          class="yt-modal browser-import-dialog"
          aria-label={t("settings.browserImportTitle")}
          ref={dialog}
          onCancel={(event) => { event.preventDefault(); close(); }}
          onClose={() => { if (open()) close(); }}
          onClick={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <div class="yt-modal__body browser-import-dialog__body">
            <h2 class="yt-modal__title browser-import-dialog__title">{t("settings.browserImportTitle")}</h2>
            <fieldset class="browser-import-dialog__browsers">
              <legend>{t("settings.browserChooseSource")}</legend>
              <Show when={sources().length > 0} fallback={<p class="browser-import-dialog__empty">{t("settings.browserNoSources")}</p>}>
                <For each={sources()}>{(source) => (
                  <label class="browser-import-dialog__browser" classList={{ "is-selected": selectedBrowser() === source.id }}>
                    <input
                      type="radio"
                      name="browser-source"
                      value={source.id}
                      checked={selectedBrowser() === source.id}
                      onChange={() => {
                        setSelectedBrowser(source.id);
                        if (!source.hasYoutubeHistory) setImportHistory(false);
                      }}
                    />
                    <span class="browser-import-dialog__browser-name">{source.name}{source.isDefault ? ` · ${t("settings.browserSourceDefault")}` : ""}</span>
                    <span class="browser-import-dialog__browser-status">
                      {source.hasYoutubeHistory ? t("settings.browserSourceHistoryAvailable") : t("settings.browserSourceNoHistory")}
                    </span>
                  </label>
                )}</For>
              </Show>
            </fieldset>

            <fieldset class="browser-import-dialog__choices" aria-label={t("settings.browserImportOptions")}>
              <label class="browser-import-dialog__choice">
                <input type="checkbox" checked={importAccount()} onChange={(event) => setImportAccount(event.currentTarget.checked)} />
                <span>{t("settings.browserAccountsCheckbox")}</span>
              </label>
              <label class="browser-import-dialog__choice" classList={{ "is-disabled": !selectedSource()?.hasYoutubeHistory }}>
                <input
                  type="checkbox"
                  checked={importHistory()}
                  disabled={!selectedSource()?.hasYoutubeHistory}
                  onChange={(event) => setImportHistory(event.currentTarget.checked)}
                />
                <span>{t("settings.browserHistoryCheckbox")}</span>
              </label>
            </fieldset>

            <Show
              when={importAccount() && importHistory()}
              fallback={
                <>
                  <Show when={importAccount()}>
                    <p class="browser-import-dialog__note" role="note">{t("settings.browserAccountsHint")}</p>
                  </Show>
                  <Show when={importHistory()}>
                    <p class="browser-import-dialog__note" role="note">{t("settings.browserImportNote")}</p>
                  </Show>
                </>
              }
            >
              <p class="browser-import-dialog__note" role="note">{t("settings.browserCombinedImportNote")}</p>
            </Show>
            <Show when={status()}><p class="browser-import-dialog__status" role="status">{status()}</p></Show>
          </div>

          <footer class="yt-modal__actions browser-import-dialog__actions">
            <button type="button" class="yt-button yt-button--text" onClick={close}>{t("common.cancel")}</button>
            <button
              type="button"
              class="yt-button yt-button--filled"
              disabled={busy() || (!complete() && !importAccount() && !importHistory())}
              onClick={() => void importSelected()}
            >
              {busy() ? t("settings.browserImporting") : complete() ? t("settings.browserImportClose") : t("settings.browserImportAction")}
            </button>
          </footer>
        </dialog>
      </Portal>
    </Show>
  );
}

export function renderBrowserImportDialog(host: HTMLElement): void {
  render(() => <BrowserImportDialog />, host);
}
