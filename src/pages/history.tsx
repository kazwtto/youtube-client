import { convertFileSrc } from "@tauri-apps/api/core";
import { For, Show, createMemo, createSignal, onCleanup, onMount, createUniqueId, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { createStore, reconcile } from "solid-js/store";

import { Icon } from "../components/icons";
import { getLocale, t, type TranslationKey } from "../i18n";
import { api, type HistoryEntry } from "../lib/api";

type DateFilter = "all" | "today" | "yesterday" | "week";
type ViewMode = "list" | "grid";
const HISTORY_PAGE_SIZE = 300;

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem("yt_history_view") === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

function saveViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem("yt_history_view", mode);
  } catch {
    // The view preference is optional when storage is unavailable.
  }
}

const FILTERS: ReadonlyArray<readonly [DateFilter, TranslationKey]> = [
  ["all", "history.filterAll"],
  ["today", "history.filterToday"],
  ["yesterday", "history.filterYesterday"],
  ["week", "history.filterWeek"],
];

function dayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function groupLabel(timestamp: number): string {
  const day = dayStart(timestamp);
  const today = dayStart(Date.now());
  if (day === today) return t("history.today");
  if (day === today - 86_400_000) return t("history.yesterday");
  return new Date(timestamp).toLocaleDateString(getLocale(), { day: "numeric", month: "long", year: "numeric" });
}

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function thumbnailFor(entry: HistoryEntry): string | null {
  if (entry.thumbnailPath) {
    return entry.thumbnailPath.startsWith("https://") || entry.thumbnailPath.startsWith("http://")
      ? entry.thumbnailPath
      : convertFileSrc(entry.thumbnailPath);
  }
  return /^[A-Za-z0-9_-]{6,}$/.test(entry.id)
    ? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`
    : null;
}

function factLine(entry: HistoryEntry): string {
  const watched = new Date(entry.lastWatchedAt).toLocaleDateString(getLocale(), {
    day: "numeric",
    month: "short",
    year: new Date(entry.lastWatchedAt).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
  const views = entry.watchCount === 1
    ? t("history.view.one", { count: entry.watchCount })
    : t("history.view.other", { count: entry.watchCount });
  return [entry.channel, views, watched].filter(Boolean).join(" · ");
}

function playbackPosition(entry: HistoryEntry): string {
  const watched = formatDuration(entry.watchedSecs);
  const position = formatDuration(entry.positionSecs);
  const duration = formatDuration(entry.durationSecs);
  return watched && position && duration
    ? t("history.playbackProgress", { watched, position, duration })
    : "";
}

function filteredEntries(entries: readonly HistoryEntry[], filter: DateFilter): HistoryEntry[] {
  const today = dayStart(Date.now());
  const yesterday = today - 86_400_000;
  const weekAgo = Date.now() - 7 * 86_400_000;
  return entries.filter((entry) => {
    if (filter === "today") return dayStart(entry.lastWatchedAt) === today;
    if (filter === "yesterday") return dayStart(entry.lastWatchedAt) === yesterday;
    if (filter === "week") return entry.lastWatchedAt >= weekAgo;
    return true;
  });
}

interface HistoryCardProps {
  entry: HistoryEntry;
  newlyVisible: Accessor<Set<string>>;
  openMenu: Accessor<string | null>;
  setOpenMenu: (id: string | null) => void;
  play: (id: string) => void;
  copy: (id: string) => void;
  remove: (id: string) => void;
}

function HistoryCard(props: HistoryCardProps) {
  const [thumbnail, setThumbnail] = createSignal(thumbnailFor(props.entry));
  const menuId = createUniqueId();
  const title = (): string => `${props.entry.title} — ${t("history.play")}`;
  const progress = (): number => props.entry.positionSecs && props.entry.durationSecs
    ? Math.min(100, Math.max(0, props.entry.positionSecs / props.entry.durationSecs * 100))
    : 0;

  return (
    <article class="history-item" classList={{ "history-item--enter": props.newlyVisible().has(props.entry.id) }}>
      <button type="button" class="history-item__primary" aria-label={title()} onClick={() => props.play(props.entry.id)}>
        <span class="history-item__thumb">
          <Show when={thumbnail()} fallback={<span class="history-item__image history-item__image--empty" aria-hidden="true" />}>
            <img
              class="history-item__image"
              src={thumbnail()!}
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
              onError={(event) => {
                const image = event.currentTarget;
                if (image.src.includes("hqdefault.jpg")) setThumbnail(`https://i.ytimg.com/vi/${props.entry.id}/mqdefault.jpg`);
                else setThumbnail(null);
              }}
            />
          </Show>
          <Show when={formatDuration(props.entry.durationSecs)}>
            {(duration) => <span class="history-item__duration">{duration()}</span>}
          </Show>
          <Show when={progress() > 0}>
            <span class="history-item__progress" aria-hidden="true">
              <span style={{ width: `${progress()}%` }} />
            </span>
          </Show>
          <span class="history-item__scrim" aria-hidden="true"><span><Icon name="play" size={22} /></span></span>
        </span>
        <span class="history-item__body">
          <span class="history-item__title" role="heading" aria-level={3}>{props.entry.title}</span>
          <span class="history-item__meta">{factLine(props.entry)}</span>
          <Show when={playbackPosition(props.entry)}>
            {(label) => <span class="history-item__progress-label">{label()}</span>}
          </Show>
        </span>
      </button>
      <div class="history-item__menu">
        <button
          type="button"
          class="yt-icon-button history-item__more"
          title={t("history.more")}
          aria-label={t("history.more")}
          aria-haspopup="menu"
          aria-expanded={props.openMenu() === props.entry.id}
          aria-controls={menuId}
          onClick={(event) => {
            event.stopPropagation();
            props.setOpenMenu(props.openMenu() === props.entry.id ? null : props.entry.id);
          }}
        >
          <Icon name="more" size={20} />
        </button>
        <div id={menuId} class="history-menu" role="menu" hidden={props.openMenu() !== props.entry.id}>
          <button type="button" class="history-menu__item" role="menuitem" onClick={() => props.play(props.entry.id)}>
            <Icon name="play" size={20} /><span>{t("history.play")}</span>
          </button>
          <button type="button" class="history-menu__item" role="menuitem" onClick={() => props.copy(props.entry.id)}>
            <Icon name="copy" size={18} /><span>{t("history.copyLink")}</span>
          </button>
          <button type="button" class="history-menu__item" role="menuitem" onClick={() => props.remove(props.entry.id)}>
            <Icon name="trash" size={18} /><span>{t("history.removeFromHistory")}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function HistoryPage(props: { host: HTMLElement }) {
  const [entries, setEntries] = createStore<HistoryEntry[]>([]);
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<DateFilter>("all");
  const [view, setView] = createSignal<ViewMode>(readViewMode());
  const [status, setStatus] = createSignal("");
  const [hasMore, setHasMore] = createSignal(false);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [toast, setToast] = createSignal("");
  const [openMenu, setOpenMenu] = createSignal<string | null>(null);
  const [newlyVisible, setNewlyVisible] = createSignal(new Set<string>());
  const filtered = createMemo(() => filteredEntries(entries, filter()));
  const groups = createMemo(() => {
    const grouped = new Map<number, HistoryEntry[]>();
    for (const entry of filtered()) {
      const key = dayStart(entry.lastWatchedAt);
      const group = grouped.get(key);
      if (group) group.push(entry);
      else grouped.set(key, [entry]);
    }
    return [...grouped.entries()].map(([day, items]) => ({ key: day, label: groupLabel(items[0].lastWatchedAt), items }));
  });

  let searchTimer: number | undefined;
  let toastTimer: number | undefined;
  let entryAnimationTimer: number | undefined;
  let request = 0;
  let loadedCount = 0;

  const markNewEntries = (ids: Set<string>): void => {
    setNewlyVisible(ids);
    if (entryAnimationTimer !== undefined) window.clearTimeout(entryAnimationTimer);
    if (ids.size > 0) entryAnimationTimer = window.setTimeout(() => setNewlyVisible(new Set<string>()), 200);
  };

  const showToast = (message: string): void => {
    setToast(message);
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setToast(""), 2200);
  };

  const play = async (id: string): Promise<void> => {
    setOpenMenu(null);
    document.dispatchEvent(new CustomEvent("app:navigate", { detail: "home" }));
    try {
      await api.ytPlayVideo(id);
    } catch (error) {
      setStatus(t("common.error", { error: String(error) }));
    }
  };

  const copy = async (id: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${id}`);
      showToast(t("history.linkCopied"));
    } catch {
      // ignore clipboard error
    }
    setOpenMenu(null);
  };

  const load = async (): Promise<void> => {
    const currentRequest = ++request;
    setHasMore(false);
    setLoadingMore(false);
    const previousIds = new Set(filtered().map((entry) => entry.id));
    const search = query().trim();
    try {
      const next = await api.historyList({ search, limit: HISTORY_PAGE_SIZE, offset: 0 });
      if (currentRequest !== request) return;
      setEntries(reconcile(next, { key: "id" }));
      loadedCount = next.length;
      setHasMore(next.length === HISTORY_PAGE_SIZE);
      const visible = filteredEntries(next, filter());
      markNewEntries(new Set(visible.filter((entry) => !previousIds.has(entry.id)).map((entry) => entry.id)));
    } catch (error) {
      if (currentRequest === request) setStatus(t("history.loadError", { error: String(error) }));
    }
  };

  const loadMore = async (): Promise<void> => {
    if (loadingMore() || !hasMore()) return;
    const search = query().trim();
    const currentRequest = ++request;
    setLoadingMore(true);
    setStatus("");
    try {
      const next = await api.historyList({ search, limit: HISTORY_PAGE_SIZE, offset: loadedCount });
      if (currentRequest !== request || search !== query().trim()) return;
      const previousIds = new Set(entries.map((entry) => entry.id));
      setEntries(reconcile([...entries, ...next], { key: "id" }));
      loadedCount += next.length;
      setHasMore(next.length === HISTORY_PAGE_SIZE);
      const visible = filteredEntries([...entries, ...next], filter());
      markNewEntries(new Set(visible.filter((entry) => !previousIds.has(entry.id)).map((entry) => entry.id)));
    } catch (error) {
      if (currentRequest === request) setStatus(t("history.loadError", { error: String(error) }));
    } finally {
      if (currentRequest === request) setLoadingMore(false);
    }
  };

  const changeFilter = (next: DateFilter): void => {
    setOpenMenu(null);
    const previousIds = new Set(filtered().map((entry) => entry.id));
    const nextItems = filteredEntries(entries, next);
    setFilter(next);
    markNewEntries(new Set(nextItems.filter((entry) => !previousIds.has(entry.id)).map((entry) => entry.id)));
  };

  const remove = async (id: string): Promise<void> => {
    setOpenMenu(null);
    const entry = entries.find((item) => item.id === id);
    if (!window.confirm(t("history.confirmRemove", { title: entry?.title ?? id }))) return;
    try {
      await api.historyDelete(id);
      setStatus(t("history.removed"));
      await load();
    } catch (error) {
      setStatus(t("common.error", { error: String(error) }));
    }
  };

  const clear = async (): Promise<void> => {
    setOpenMenu(null);
    if (!window.confirm(t("history.confirmClear"))) return;
    try {
      await api.historyClear();
      setStatus(t("history.cleared"));
      await load();
    } catch (error) {
      setStatus(t("common.error", { error: String(error) }));
    }
  };

  onMount(() => {
    const closeMenus = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".history-item__menu")) setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      const trigger = props.host.querySelector<HTMLButtonElement>(".history-item__more[aria-expanded='true']");
      setOpenMenu(null);
      trigger?.focus();
    };
    const activate = (): void => void load();
    document.addEventListener("click", closeMenus);
    document.addEventListener("keydown", onKeyDown);
    props.host.addEventListener("page:activated", activate);
    void load();
    onCleanup(() => {
      request += 1;
      document.removeEventListener("click", closeMenus);
      document.removeEventListener("keydown", onKeyDown);
      props.host.removeEventListener("page:activated", activate);
      if (searchTimer !== undefined) window.clearTimeout(searchTimer);
      if (toastTimer !== undefined) window.clearTimeout(toastTimer);
      if (entryAnimationTimer !== undefined) window.clearTimeout(entryAnimationTimer);
    });
  });

  return (
    <section class="page page--history">
      <header class="page__header page__header--row">
        <div>
          <h1>{t("history.title")}</h1>
          <p class="page__lead">{t("history.lead")}</p>
        </div>
        <button type="button" class="yt-button yt-button--danger" onClick={() => void clear()}>
          <Icon name="trash" size={18} /><span>{t("history.clear")}</span>
        </button>
      </header>

      <div class="history-toolbar">
        <div class="yt-search">
          <Icon name="search" size={20} />
          <input
            type="search"
            value={query()}
            placeholder={t("history.searchPlaceholder")}
            aria-label={t("history.searchPlaceholder")}
            autocomplete="off"
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setStatus("");
              setHasMore(false);
              setOpenMenu(null);
              if (searchTimer !== undefined) window.clearTimeout(searchTimer);
              searchTimer = window.setTimeout(() => void load(), 200);
            }}
          />
        </div>

        <div class="history-filters" role="group" aria-label={t("history.filterDate")}>
          <For each={FILTERS}>
            {([id, key]) => (
              <button type="button" class="history-filter-chip" classList={{ "is-active": filter() === id }} aria-pressed={filter() === id} onClick={() => changeFilter(id)}>
                {t(key)}
              </button>
            )}
          </For>
        </div>

        <span class="history-count">{filtered().length ? t("history.count", { count: filtered().length }) : ""}</span>
        <div class="history-view-toggle" role="group" aria-label={t("history.viewMode")}>
          <button type="button" class="history-view-btn" classList={{ "is-active": view() === "list" }} title={t("history.viewList")} aria-label={t("history.viewList")} aria-pressed={view() === "list"} onClick={() => { setView("list"); saveViewMode("list"); }}>
            <Icon name="list" size={18} />
          </button>
          <button type="button" class="history-view-btn" classList={{ "is-active": view() === "grid" }} title={t("history.viewGrid")} aria-label={t("history.viewGrid")} aria-pressed={view() === "grid"} onClick={() => { setView("grid"); saveViewMode("grid"); }}>
            <Icon name="grid" size={18} />
          </button>
        </div>
      </div>

      <div class="history" classList={{ "history--grid": view() === "grid", "history--list": view() === "list" }}>
        <Show when={filtered().length > 0} fallback={
          <div class="yt-empty">
            <Icon name={query().trim() ? "search" : "clock"} size={query().trim() ? 20 : 56} />
            <p><strong>{query().trim() ? t("history.noResults", { query: query().trim() }) : t("history.empty")}</strong></p>
            <p>{query().trim() ? t("history.noResultsHint") : t("history.emptyHint")}</p>
          </div>
        }>
          <For each={groups()}>
            {(group) => (
              <section class="history-group">
                <div class="history-group__header">
                  <h2 class="history-group__title">{group.label}</h2>
                  <span class="history-group__count">({group.items.length})</span>
                </div>
                <div class="history-group__items">
                  <For each={group.items}>
                    {(entry) => <HistoryCard entry={entry} newlyVisible={newlyVisible} openMenu={openMenu} setOpenMenu={setOpenMenu} play={(id) => void play(id)} copy={(id) => void copy(id)} remove={(id) => void remove(id)} />}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>
        <Show when={hasMore()}>
          <div class="history-load-more">
            <button type="button" class="yt-button yt-button--tonal" disabled={loadingMore()} onClick={() => void loadMore()}>
              {loadingMore() ? t("history.loadingMore") : t("history.loadMore")}
            </button>
          </div>
        </Show>
      </div>

      <p class="status" role="status" aria-live="polite">{status()}</p>
      <div class="history-toast" classList={{ "is-visible": toast() !== "" }} aria-live="polite">{toast()}</div>
    </section>
  );
}

export function renderHistory(host: HTMLElement): void {
  render(() => <HistoryPage host={host} />, host);
}
