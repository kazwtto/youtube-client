import "../styles/pip.css";

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { For, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";

import { Icon } from "../components/icons";
import { initI18n, onLanguageChange, t } from "../i18n";
import { initTheme } from "../theme/provider";

const VIDEO_ID = /^[A-Za-z0-9_-]{6,32}$/;
/** Messages the buttons drawn inside the player frame send to this page. */
const FRAME_SOURCE = "ytdesktop-pip";
const RESIZE_HANDLES = ["North", "South", "East", "West", "NorthEast", "NorthWest", "SouthEast", "SouthWest"] as const;
type ResizeDirection = (typeof RESIZE_HANDLES)[number];

/** Player state reported by the observer running inside the YouTube page. */
interface PlayerSnapshot {
  videoId: string | null;
  title: string | null;
  isPlaying: boolean;
  positionSecs: number | null;
}

function PipWindow() {
  const [videoId, setVideoId] = createSignal<string | null>(null);
  const [source, setSource] = createSignal("");
  const [ready, setReady] = createSignal(false);
  const [snapshotKnown, setSnapshotKnown] = createSignal(false);
  let frame!: HTMLIFrameElement;
  let revealTimer: number | undefined;
  let unlisten: UnlistenFn | undefined;
  let disposed = false;

  const appWindow = getCurrentWindow();
  const close = (): void => {
    void invoke("pip_close").catch(() => void appWindow.close());
  };
  const revealSoon = (): void => {
    if (revealTimer !== undefined) window.clearTimeout(revealTimer);
    // A frame that never answers must not leave the spinner over the video.
    revealTimer = window.setTimeout(() => setReady(true), 6000);
  };
  const markReady = (): void => {
    if (revealTimer !== undefined) {
      window.clearTimeout(revealTimer);
      revealTimer = undefined;
    }
    setReady(true);
  };
  const load = (id: string, startSeconds = 0): void => {
    if (!VIDEO_ID.test(id) || id === videoId()) return;
    setSnapshotKnown(true);
    const offset = Number.isFinite(startSeconds) && startSeconds > 1 ? `&start=${Math.floor(startSeconds)}` : "";
    setReady(false);
    setVideoId(id);
    setSource(`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1${offset}`);
    revealSoon();
  };

  const resize = (event: PointerEvent, direction: ResizeDirection): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    void appWindow.startResizeDragging(direction).catch(() => undefined);
  };
  const startDragging = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    void appWindow.startDragging().catch(() => undefined);
  };

  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame?.contentWindow) return;
    const data = event.data as { source?: string; action?: string; value?: number; dx?: number; dy?: number; time?: number } | null;
    if (!data || data.source !== FRAME_SOURCE) return;
    if (data.action === "drag" || data.action === "drag_start") {
      void invoke("pip_drag_start").catch(() => undefined);
    } else if (data.action === "move_by") {
      const dx = Number(data.dx) || 0;
      const dy = Number(data.dy) || 0;
      if (dx || dy) void invoke("pip_move_by", { dx, dy }).catch(() => undefined);
    } else if (data.action === "drag_end") {
      void invoke("pip_drag_end").catch(() => undefined);
    } else if (data.action === "sync_time") {
      const time = Number(data.value ?? data.time);
      if (Number.isFinite(time) && time >= 0) void invoke("pip_sync_time", { time }).catch(() => undefined);
    } else if (data.action === "ratio") {
      const value = Number(data.value);
      if (Number.isFinite(value) && value >= 0.4 && value <= 3.5) void invoke("pip_set_ratio", { value }).catch(() => undefined);
    } else if (data.action === "prev" || data.action === "next") {
      void invoke("pip_next", { direction: data.action }).catch(() => undefined);
    } else if (data.action === "restore") {
      void invoke("pip_restore").catch(() => undefined);
    } else if (data.action === "close") close();
  };

  onMount(() => {
    const updateTitle = (): void => { document.title = t("pip.windowTitle"); };
    const stopLanguage = onLanguageChange(updateTitle);
    updateTitle();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    revealSoon();
    window.addEventListener("message", onMessage);
    document.addEventListener("keydown", onKeyDown);
    // The page follows the video that the YouTube webview is playing, so the next
    // video advances the mini player without reopening it.
    void listen<PlayerSnapshot | null>("pip://player", (event) => {
      const id = event.payload?.videoId ?? "";
      if (VIDEO_ID.test(id)) load(id, event.payload?.positionSecs ?? 0);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    void invoke<PlayerSnapshot | null>("pip_current")
      .then((snapshot) => {
        const id = snapshot?.videoId ?? "";
        if (VIDEO_ID.test(id)) load(id, snapshot?.positionSecs ?? 0);
        else setSnapshotKnown(true);
      })
      .catch(() => setSnapshotKnown(true));

    onCleanup(() => {
      stopLanguage();
      window.removeEventListener("message", onMessage);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  onCleanup(() => {
    disposed = true;
    unlisten?.();
    if (revealTimer !== undefined) window.clearTimeout(revealTimer);
  });

  return (
    <div class="pip__frame" classList={{ "is-ready": ready() }}>
      {videoId() !== null || !snapshotKnown() ? (
        <>
          <iframe
            class="pip__video"
            src={source() || undefined}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            title={t("titlebar.pip")}
            onLoad={markReady}
            ref={frame}
          />
          <div class="pip__loading" aria-label={t("youtube.loading")}>
            <div class="pip__spinner" />
          </div>
        </>
      ) : (
        <div class="pip__empty" onPointerDown={startDragging}>
          <Icon name="pip-screen" size={24} class="pip__empty-icon" />
          <p class="pip__empty-title">{t("pip.emptyTitle")}</p>
          <p class="pip__empty-hint">{t("pip.emptyHint")}</p>
        </div>
      )}
      <For each={RESIZE_HANDLES}>
        {(direction) => <span class={`pip__resize pip__resize--${direction.toLowerCase()}`} onPointerDown={(event) => resize(event, direction)} />}
      </For>
    </div>
  );
}

async function mount(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#pip-root");
  if (!root) return;
  await initI18n();
  await initTheme();
  render(() => <PipWindow />, root);
}

void mount();
