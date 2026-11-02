import { convertFileSrc } from "@tauri-apps/api/core";

import { icon } from "../components/icons";
import { getLocale, t } from "../i18n";
import { api, type HistoryEntry } from "../lib/api";
import { escapeHtml } from "../lib/html";

let menuAbort: AbortController | undefined;

function dayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function groupLabel(timestamp: number): string {
  const day = dayStart(timestamp);
  const today = dayStart(Date.now());

  if (day === today) {
    return t("history.today");
  }

  if (day === today - 86_400_000) {
    return t("history.yesterday");
  }

  return new Date(timestamp).toLocaleDateString(getLocale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function thumbnailFor(entry: HistoryEntry): string | null {
  if (entry.thumbnailPath) {
    if (entry.thumbnailPath.startsWith("http://") || entry.thumbnailPath.startsWith("https://")) {
      return entry.thumbnailPath;
    }
    return convertFileSrc(entry.thumbnailPath);
  }

  if (/^[A-Za-z0-9_-]{6,}$/.test(entry.id)) {
    return `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`;
  }

  return null;
}

export async function renderHistory(host: HTMLElement): Promise<void> {
  host.innerHTML = `
    <section class="page page--history">
      <header class="page__header page__header--row">
        <div>
          <h1>${t("history.title")}</h1>
          <p class="page__lead">${t("history.lead")}</p>
        </div>
        <button type="button" class="yt-button yt-button--danger" id="history-clear">
          ${icon("trash", 18)}<span>${t("history.clear")}</span>
        </button>
      </header>

      <div class="history-toolbar">
        <div class="yt-search">
          ${icon("search", 20)}
          <input
            type="search"
            id="history-search"
            placeholder="${t("history.searchPlaceholder")}"
            aria-label="${t("history.searchPlaceholder")}"
            autocomplete="off"
          />
        </div>

        <div class="history-filters" role="radiogroup" aria-label="Filtro de data">
          <button type="button" class="history-filter-chip is-active" data-filter="all">${t("history.filterAll")}</button>
          <button type="button" class="history-filter-chip" data-filter="today">${t("history.filterToday")}</button>
          <button type="button" class="history-filter-chip" data-filter="yesterday">${t("history.filterYesterday")}</button>
          <button type="button" class="history-filter-chip" data-filter="week">${t("history.filterWeek")}</button>
        </div>

        <span class="history-count" id="history-count"></span>

        <div class="history-view-toggle" role="group" aria-label="Modo de exibição">
          <button type="button" class="history-view-btn is-active" data-view="list" title="${t("history.viewList")}" aria-label="${t("history.viewList")}">
            ${icon("list", 18)}
          </button>
          <button type="button" class="history-view-btn" data-view="grid" title="${t("history.viewGrid")}" aria-label="${t("history.viewGrid")}">
            ${icon("grid", 18)}
          </button>
        </div>
      </div>

      <div id="history-list" class="history history--list"></div>
      <p class="status" id="history-status" role="status" aria-live="polite"></p>
      <div class="history-toast" id="history-toast" aria-live="polite"></div>
    </section>
  `;

  const list = host.querySelector<HTMLElement>("#history-list")!;
  const search = host.querySelector<HTMLInputElement>("#history-search")!;
  const clearButton = host.querySelector<HTMLButtonElement>("#history-clear")!;
  const status = host.querySelector<HTMLElement>("#history-status")!;
  const count = host.querySelector<HTMLElement>("#history-count")!;
  const toast = host.querySelector<HTMLElement>("#history-toast")!;

  let timer: number | undefined;
  let toastTimer: number | undefined;
  let request = 0;
  let cachedEntries: HistoryEntry[] = [];
  let activeFilter: "all" | "today" | "yesterday" | "week" = "all";

  let viewMode: "list" | "grid" =
    (localStorage.getItem("yt_history_view") as "list" | "grid") ?? "list";

  const updateViewMode = (mode: "list" | "grid"): void => {
    viewMode = mode;
    localStorage.setItem("yt_history_view", mode);
    list.classList.toggle("history--grid", mode === "grid");
    list.classList.toggle("history--list", mode === "list");
    for (const btn of host.querySelectorAll<HTMLButtonElement>(".history-view-btn")) {
      btn.classList.toggle("is-active", btn.dataset.view === mode);
    }
  };

  updateViewMode(viewMode);

  for (const btn of host.querySelectorAll<HTMLButtonElement>(".history-view-btn")) {
    btn.addEventListener("click", () => {
      if (btn.dataset.view === "list" || btn.dataset.view === "grid") {
        updateViewMode(btn.dataset.view);
      }
    });
  }

  for (const chip of host.querySelectorAll<HTMLButtonElement>(".history-filter-chip")) {
    chip.addEventListener("click", () => {
      activeFilter = (chip.dataset.filter as typeof activeFilter) || "all";
      for (const c of host.querySelectorAll(".history-filter-chip")) {
        c.classList.toggle("is-active", c === chip);
      }
      renderFiltered();
    });
  }

  function showToast(message: string): void {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    if (toastTimer !== undefined) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2200);
  }

  async function copyLink(id: string): Promise<void> {
    const url = `https://www.youtube.com/watch?v=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(t("history.linkCopied"));
    } catch {
      // ignore clipboard error
    }
  }

  const closeMenus = (): void => {
    for (const panel of list.querySelectorAll<HTMLElement>(".history-menu")) {
      panel.hidden = true;
    }
  };

  menuAbort?.abort();
  menuAbort = new AbortController();
  document.addEventListener("click", closeMenus, { signal: menuAbort.signal });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        closeMenus();
      }
    },
    { signal: menuAbort.signal },
  );

  async function play(id: string): Promise<void> {
    document.dispatchEvent(new CustomEvent("app:navigate", { detail: "home" }));

    try {
      await api.ytPlayVideo(id);
    } catch (error) {
      status.textContent = t("common.error", { error: String(error) });
    }
  }

  function factLine(entry: HistoryEntry): string {
    const watched = new Date(entry.lastWatchedAt).toLocaleDateString(getLocale(), {
      day: "numeric",
      month: "short",
      year:
        new Date(entry.lastWatchedAt).getFullYear() === new Date().getFullYear()
          ? undefined
          : "numeric",
    });

    const views =
      entry.watchCount === 1
        ? t("history.view.one", { count: entry.watchCount })
        : t("history.view.other", { count: entry.watchCount });

    return [entry.channel, views, watched].filter(Boolean).join(" · ");
  }

  function item(entry: HistoryEntry): HTMLElement {
    const element = document.createElement("article");
    element.className = "history-item";
    element.tabIndex = 0;
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", `${entry.title} — ${t("history.play")}`);

    const thumbnail = thumbnailFor(entry);
    const duration = formatDuration(entry.durationSecs);

    element.innerHTML = `
      <div class="history-item__thumb">
        ${
          thumbnail
            ? `<img class="history-item__image" src="${escapeHtml(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
            : `<span class="history-item__image history-item__image--empty" aria-hidden="true"></span>`
        }
        ${duration ? `<span class="history-item__duration">${duration}</span>` : ""}
        <span class="history-item__scrim" aria-hidden="true"><span>${icon("play", 22)}</span></span>
      </div>
      <div class="history-item__body">
        <h3 class="history-item__title">${escapeHtml(entry.title)}</h3>
        <p class="history-item__meta">${escapeHtml(factLine(entry))}</p>
      </div>
      <div class="history-item__menu">
        <button
          type="button"
          class="yt-icon-button history-item__more"
          data-menu
          title="${t("history.more")}"
          aria-label="${t("history.more")}"
          aria-haspopup="menu"
        >${icon("more", 20)}</button>
        <div class="history-menu" role="menu" hidden>
          <button type="button" class="history-menu__item" role="menuitem" data-play>
            ${icon("play", 20)}<span>${t("history.play")}</span>
          </button>
          <button type="button" class="history-menu__item" role="menuitem" data-copy>
            ${icon("copy", 18)}<span>${t("history.copyLink")}</span>
          </button>
          <button type="button" class="history-menu__item" role="menuitem" data-remove>
            ${icon("trash", 18)}<span>${t("history.removeFromHistory")}</span>
          </button>
        </div>
      </div>
    `;

    element.querySelector<HTMLImageElement>(".history-item__image")?.addEventListener(
      "error",
      (event) => {
        const image = event.currentTarget as HTMLImageElement;
        if (image.src.includes("hqdefault.jpg")) {
          image.src = `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`;
          return;
        }
        image.classList.add("history-item__image--empty");
        image.removeAttribute("src");
      },
      { once: true },
    );

    element.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;

      if (target.closest("[data-menu]")) {
        return;
      }

      if (target.closest("[data-play]")) {
        closeMenus();
        void play(entry.id);
        return;
      }

      if (target.closest("[data-copy]")) {
        closeMenus();
        void copyLink(entry.id);
        return;
      }

      if (target.closest("[data-remove]")) {
        closeMenus();
        void remove(entry.id);
        return;
      }

      if (target.closest(".history-menu")) {
        return;
      }

      void play(entry.id);
    });

    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void play(entry.id);
      }
    });

    element
      .querySelector<HTMLButtonElement>("[data-menu]")
      ?.addEventListener("click", (event) => {
        event.stopPropagation();
        const panel = element.querySelector<HTMLElement>(".history-menu")!;
        const wasHidden = panel.hidden;
        closeMenus();
        panel.hidden = !wasHidden;
      });

    return element;
  }

  async function remove(id: string): Promise<void> {
    try {
      await api.historyDelete(id);
      status.textContent = t("history.removed");
      await load();
    } catch (error) {
      status.textContent = t("common.error", { error: String(error) });
    }
  }

  function emptyState(query: string): void {
    list.innerHTML = query
      ? `
        <div class="yt-empty">
          ${icon("search", 20)}
          <p><strong>${t("history.noResults", { query: escapeHtml(query) })}</strong></p>
          <p>${t("history.noResultsHint")}</p>
        </div>
      `
      : `
        <div class="yt-empty">
          ${icon("clock", 56)}
          <p><strong>${t("history.empty")}</strong></p>
          <p>${t("history.emptyHint")}</p>
        </div>
      `;
  }

  function renderFiltered(): void {
    const today = dayStart(Date.now());
    const yesterday = today - 86_400_000;
    const weekAgo = Date.now() - 7 * 86_400_000;

    const filtered = cachedEntries.filter((entry) => {
      if (activeFilter === "today") {
        return dayStart(entry.lastWatchedAt) === today;
      }
      if (activeFilter === "yesterday") {
        return dayStart(entry.lastWatchedAt) === yesterday;
      }
      if (activeFilter === "week") {
        return entry.lastWatchedAt >= weekAgo;
      }
      return true;
    });

    list.replaceChildren();
    count.textContent =
      filtered.length > 0 ? t("history.count", { count: filtered.length }) : "";

    if (filtered.length === 0) {
      emptyState(search.value.trim());
      return;
    }

    const groups = new Map<string, HistoryEntry[]>();
    for (const entry of filtered) {
      const label = groupLabel(entry.lastWatchedAt);
      const group = groups.get(label);
      if (group) {
        group.push(entry);
      } else {
        groups.set(label, [entry]);
      }
    }

    for (const [label, groupEntries] of groups) {
      const group = document.createElement("section");
      group.className = "history-group";

      const heading = document.createElement("div");
      heading.className = "history-group__header";
      heading.innerHTML = `
        <h2 class="history-group__title">${label}</h2>
        <span class="history-group__count">(${groupEntries.length})</span>
      `;
      group.append(heading);

      const itemsWrap = document.createElement("div");
      itemsWrap.className = "history-group__items";

      for (const entry of groupEntries) {
        itemsWrap.append(item(entry));
      }
      group.append(itemsWrap);

      list.append(group);
    }
  }

  async function load(): Promise<void> {
    const current = ++request;
    const query = search.value.trim();

    try {
      cachedEntries = await api.historyList({ search: query, limit: 300, offset: 0 });
      if (current !== request) {
        return;
      }
      renderFiltered();
    } catch (error) {
      if (current === request) {
        list.textContent = t("history.loadError", { error: String(error) });
      }
    }
  }

  search.addEventListener("input", () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }

    timer = window.setTimeout(() => {
      void load();
    }, 200);
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
