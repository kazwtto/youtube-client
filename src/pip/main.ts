import "../styles/pip.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { icon } from "../components/icons";

const VIDEO_ID = /^[A-Za-z0-9_-]{6,32}$/;

/** Messages the buttons drawn inside the player frame send to this page. */
const FRAME_SOURCE = "ytdesktop-pip";

/** Player state reported by the observer running inside the YouTube page. */
interface PlayerSnapshot {
  videoId: string | null;
  title: string | null;
  isPlaying: boolean;
  positionSecs: number | null;
}

type ResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

const RESIZE_HANDLES: ResizeDirection[] = [
  "North",
  "South",
  "East",
  "West",
  "NorthEast",
  "NorthWest",
  "SouthEast",
  "SouthWest",
];

function mount(): void {
  const root = document.querySelector<HTMLElement>("#pip-root");
  if (!root) {
    return;
  }

  const appWindow = getCurrentWindow();

  const close = (): void => {
    void invoke("pip_close").catch(() => {
      void appWindow.close();
    });
  };

  const resizeHandles = RESIZE_HANDLES.map(
    (direction) =>
      `<span class="pip__resize pip__resize--${direction.toLowerCase()}" data-resize="${direction}"></span>`
  ).join("");

  const bindInteractions = (host: HTMLElement): void => {
    for (const surface of host.querySelectorAll<HTMLElement>("[data-drag]")) {
      surface.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        void appWindow.startDragging().catch(() => undefined);
      });
    }

    for (const handle of host.querySelectorAll<HTMLElement>("[data-resize]")) {
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        void appWindow
          .startResizeDragging(handle.dataset.resize as ResizeDirection)
          .catch(() => undefined);
      });
    }
  };

  const renderEmpty = (): void => {
    root.innerHTML = `
      <div class="pip__frame">
        <div class="pip__empty" data-drag>
          ${icon("pip-screen", 24, "pip__empty-icon")}
          <p class="pip__empty-title">Nada em reprodução</p>
          <p class="pip__empty-hint">Abra um vídeo no YouTube para usar o mini player.</p>
        </div>
        ${resizeHandles}
      </div>
    `;

    bindInteractions(root);
  };

  root.innerHTML = `
    <div class="pip__frame">
      <iframe
        class="pip__video"
        data-video
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        title="Mini player"
      ></iframe>

      <div class="pip__loading"><div class="pip__spinner"></div></div>

      ${resizeHandles}
    </div>
  `;

  const frameHost = root.querySelector<HTMLElement>(".pip__frame")!;
  const frame = root.querySelector<HTMLIFrameElement>("[data-video]")!;
  let currentId = "";

  bindInteractions(root);

  const reveal = (): void => {
    frameHost.classList.add("is-ready");
  };

  frame.addEventListener("load", reveal);
  // A frame that never answers must not leave the spinner over the video.
  window.setTimeout(reveal, 6000);

  const load = (id: string, startSeconds = 0): void => {
    if (!VIDEO_ID.test(id)) {
      return;
    }

    if (id === currentId) {
      return;
    }

    currentId = id;

    const offset =
      Number.isFinite(startSeconds) && startSeconds > 1 ? `&start=${Math.floor(startSeconds)}` : "";

    frameHost.classList.remove("is-ready");
    window.setTimeout(reveal, 6000);

    frame.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1${offset}`;
  };

  window.addEventListener("message", (event) => {
    const data = event.data as {
      source?: string;
      action?: string;
      value?: number;
      dx?: number;
      dy?: number;
    } | null;
    if (!data || data.source !== FRAME_SOURCE) {
      return;
    }

    if (data.action === "drag" || data.action === "drag_start") {
      void invoke("pip_drag_start").catch(() => undefined);
      return;
    }

    if (data.action === "move_by") {
      const dx = Number(data.dx) || 0;
      const dy = Number(data.dy) || 0;
      if (dx !== 0 || dy !== 0) {
        void invoke("pip_move_by", { dx, dy }).catch(() => undefined);
      }
      return;
    }

    if (data.action === "drag_end") {
      void invoke("pip_drag_end").catch(() => undefined);
      return;
    }

    if (data.action === "sync_time") {
      const time = Number(data.value ?? (data as { time?: number }).time);
      if (Number.isFinite(time) && time >= 0) {
        void invoke("pip_sync_time", { time }).catch(() => undefined);
      }
      return;
    }

    if (data.action === "ratio") {
      const value = Number(data.value);
      if (Number.isFinite(value) && value >= 0.4 && value <= 3.5) {
        void invoke("pip_set_ratio", { value }).catch(() => undefined);
      }
      return;
    }

    if (data.action === "prev" || data.action === "next") {
      void invoke("pip_next", { direction: data.action }).catch(() => undefined);
    } else if (data.action === "restore") {
      void invoke("pip_restore").catch(() => undefined);
    } else if (data.action === "close") {
      close();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
    }
  });

  // The page follows the video that the YouTube webview is playing, so the next
  // video advances the mini player without reopening it.
  void listen<PlayerSnapshot | null>("pip://player", (event) => {
    const snapshot = event.payload;
    if (!snapshot) {
      return;
    }

    const id = snapshot.videoId ?? "";
    if (VIDEO_ID.test(id)) {
      load(id, snapshot.positionSecs ?? 0);
    }
  }).catch(() => undefined);

  void invoke<PlayerSnapshot | null>("pip_current")
    .then((snapshot) => {
      const id = snapshot?.videoId ?? "";

      if (!VIDEO_ID.test(id)) {
        renderEmpty();
        return;
      }

      load(id, snapshot?.positionSecs ?? 0);
    })
    .catch(() => renderEmpty());
}

mount();
