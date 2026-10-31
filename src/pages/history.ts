import { getLocale, t } from "../i18n";
import { api } from "../lib/api";
import { escapeHtml } from "../lib/html";

export async function renderHistory(host: HTMLElement): Promise<void> {
  host.innerHTML = `
    <section class="page">
      <header class="page__header">
        <p class="eyebrow">${t("history.eyebrow")}</p>
        <h1>${t("history.title")}</h1>
        <p class="page__lead">${t("history.lead")}</p>
      </header>

      <div class="toolbar">
        <input type="search" id="history-search" class="text-input" placeholder="${t("history.searchPlaceholder")}" />
        <button type="button" class="button button--danger" id="history-clear">${t("history.clear")}</button>
      </div>

      <div id="history-list" class="history"></div>
      <p class="status" id="history-status" role="status"></p>
    </section>
  `;

  const list = host.querySelector<HTMLElement>("#history-list")!;
  const search = host.querySelector<HTMLInputElement>("#history-search")!;
  const clearButton = host.querySelector<HTMLButtonElement>("#history-clear")!;
  const status = host.querySelector<HTMLElement>("#history-status")!;

  let timer: number | undefined;

  async function load(): Promise<void> {
    try {
      const entries = await api.historyList({
        search: search.value.trim(),
        limit: 100,
        offset: 0,
      });

      list.replaceChildren();

      if (entries.length === 0) {
        list.innerHTML = `<div class="empty">${t("history.empty")}</div>`;
        return;
      }

      for (const entry of entries) {
        const watchCount =
          entry.watchCount === 1
            ? t("history.view.one", { count: entry.watchCount })
            : t("history.view.other", { count: entry.watchCount });

        const item = document.createElement("article");
        item.className = "history__item";
        item.innerHTML = `
          <div class="history__meta">
            <h2>${escapeHtml(entry.title)}</h2>
            <p class="muted">${escapeHtml(entry.channel)} · ${watchCount}</p>
            <p class="muted">${new Date(entry.lastWatchedAt).toLocaleString(getLocale())}</p>
          </div>
          <button type="button" class="button" data-remove>${t("history.remove")}</button>
        `;

        item
          .querySelector<HTMLButtonElement>("[data-remove]")
          ?.addEventListener("click", () => {
            void (async () => {
              try {
                await api.historyDelete(entry.id);
                await load();
              } catch (error) {
                status.textContent = t("common.error", {
                  error: String(error),
                });
              }
            })();
          });

        list.append(item);
      }
    } catch (error) {
      list.textContent = t("history.loadError", { error: String(error) });
    }
  }

  search.addEventListener("input", () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }

    timer = window.setTimeout(() => {
      void load();
    }, 250);
  });

  clearButton.addEventListener("click", () => {
    void (async () => {
      if (!window.confirm(t("history.confirmClear"))) {
        return;
      }

      try {
        await api.historyClear();
        status.textContent = t("history.cleared");
        await load();
      } catch (error) {
        status.textContent = t("common.error", { error: String(error) });
      }
    })();
  });

  await load();
}