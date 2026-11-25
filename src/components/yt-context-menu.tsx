import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { VirtualElement } from "@floating-ui/dom";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal, render } from "solid-js/web";

import { t } from "../i18n";
import { api } from "../lib/api";
import { setUiElevationSource } from "../lib/elevation";
import { isMotionEnabled } from "../lib/motion";
import { FloatingMenu } from "./floating-menu";
import { Icon } from "./icons";

export interface YoutubeContextMenuPayload {
  x: number;
  y: number;
  kind: "page" | "video" | "channel" | "selection";
  pageUrl: string;
  pageTitle: string;
  canGoBack: boolean;
  canGoForward: boolean;
  videoId?: string | null;
  videoUrl?: string | null;
  videoTitle?: string | null;
  channelName?: string | null;
  linkUrl?: string | null;
  selectionText?: string | null;
  currentTimeSecs?: number | null;
}

function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function YoutubeContextMenuView() {
  const [payload, setPayload] = createSignal<YoutubeContextMenuPayload | null>(null);
  const [toast, setToast] = createSignal("");
  let elevationTimer: number | undefined;
  let toastTimer: number | undefined;
  let wasOpen = false;
  let disposed = false;
  let unlisten: UnlistenFn | undefined;

  const close = (): void => {
    setPayload(null);
  };

  const notifyCopied = (text: string): void => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setToast(t("contextMenu.copied"));
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setToast(""), 1800);
  };

  const virtualAnchor = createMemo<VirtualElement | undefined>(() => {
    const current = payload();
    if (!current) return undefined;
    const x = current.x;
    const y = current.y;
    return {
      getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }),
    };
  });

  createEffect(() => {
    const isOpen = payload() !== null;
    if (isOpen) {
      if (elevationTimer !== undefined) {
        window.clearTimeout(elevationTimer);
        elevationTimer = undefined;
      }
      wasOpen = true;
      setUiElevationSource("context", true);
      return;
    }
    const shouldDelay = wasOpen && isMotionEnabled();
    wasOpen = false;
    if (shouldDelay) {
      if (elevationTimer !== undefined) window.clearTimeout(elevationTimer);
      elevationTimer = window.setTimeout(() => {
        elevationTimer = undefined;
        if (payload() === null) {
          setUiElevationSource("context", false);
        }
      }, 150);
    } else {
      setUiElevationSource("context", false);
    }
  });

  onMount(() => {
    void listen<YoutubeContextMenuPayload>("youtube://context-menu", (event) => {
      if (event.payload) {
        setPayload(event.payload);
      }
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
  });

  onCleanup(() => {
    disposed = true;
    unlisten?.();
    if (elevationTimer !== undefined) window.clearTimeout(elevationTimer);
    if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  });

  const shareTargetUrl = (): string => {
    const current = payload();
    if (!current) return "";
    if (current.videoId) return `https://youtu.be/${current.videoId}`;
    return current.linkUrl || current.pageUrl;
  };

  const timedUrl = (): string => {
    const current = payload();
    if (!current?.videoId || !current.currentTimeSecs) return "";
    return `https://youtu.be/${current.videoId}?t=${current.currentTimeSecs}`;
  };

  return (
    <>
      <FloatingMenu
        open={() => payload() !== null}
        anchor={virtualAnchor}
        placement="bottom-start"
        width={220}
        class="yt-context-menu"
        ariaLabel={t("contextMenu.title")}
        onClose={close}
      >
        <Show when={payload()}>
          {(current) => (
            <div class="yt-menu__body">
              <div class="yt-menu__quick-bar" role="group" aria-label={t("contextMenu.title")}>
                <button
                  type="button"
                  class="yt-menu__quick-btn"
                  title={t("titlebar.back")}
                  aria-label={t("titlebar.back")}
                  disabled={!current().canGoBack}
                  onClick={() => {
                    close();
                    void api.ytNavigate("back");
                  }}
                >
                  <Icon name="back" size={16} />
                </button>
                <button
                  type="button"
                  class="yt-menu__quick-btn"
                  title={t("titlebar.forward")}
                  aria-label={t("titlebar.forward")}
                  disabled={!current().canGoForward}
                  onClick={() => {
                    close();
                    void api.ytNavigate("forward");
                  }}
                >
                  <Icon name="forward" size={16} />
                </button>
                <button
                  type="button"
                  class="yt-menu__quick-btn"
                  title={t("titlebar.reload")}
                  aria-label={t("titlebar.reload")}
                  onClick={() => {
                    close();
                    void api.ytNavigate("reload");
                  }}
                >
                  <Icon name="reload" size={16} />
                </button>
                <button
                  type="button"
                  class="yt-menu__quick-btn"
                  title={t("contextMenu.share")}
                  aria-label={t("contextMenu.share")}
                  onClick={() => {
                    const url = shareTargetUrl();
                    close();
                    if (url) notifyCopied(url);
                  }}
                >
                  <Icon name="share" size={16} />
                </button>
              </div>

              <div class="yt-menu__divider" />

              <Show when={current().kind === "video" && current().videoUrl}>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const url = current().videoUrl!;
                    close();
                    void api.ytNavigate(`url:${url}`);
                  }}
                >
                  <Icon name="play" size={16} />
                  <span>{t("contextMenu.playVideo")}</span>
                </button>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const url = current().videoUrl!;
                    close();
                    void api.tabCreate({ isolated: false, url, activate: true }).catch(() => undefined);
                  }}
                >
                  <Icon name="plus" size={16} />
                  <span>{t("contextMenu.openNewTab")}</span>
                </button>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const url = current().videoUrl!;
                    close();
                    void api.tabCreate({ isolated: true, url, activate: true }).catch(() => undefined);
                  }}
                >
                  <Icon name="tab-isolated" size={16} />
                  <span>{t("contextMenu.openIsolatedTab")}</span>
                </button>
                <Show when={current().videoId}>
                  <button
                    type="button"
                    class="yt-menu__item"
                    role="menuitem"
                    onClick={() => {
                      const id = current().videoId!;
                      close();
                      void api.ytPlayVideo(id).then(() => api.pipOpen()).catch(() => undefined);
                    }}
                  >
                    <Icon name="pip" size={16} />
                    <span>{t("contextMenu.openPip")}</span>
                  </button>
                </Show>
                <Show when={current().videoTitle}>
                  <button
                    type="button"
                    class="yt-menu__item"
                    role="menuitem"
                    onClick={() => {
                      const title = current().videoTitle!;
                      close();
                      notifyCopied(title);
                    }}
                  >
                    <Icon name="copy" size={16} />
                    <span>{t("contextMenu.copyVideoTitle")}</span>
                  </button>
                </Show>
              </Show>

              <Show when={current().kind === "channel" && current().linkUrl}>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const url = current().linkUrl!;
                    close();
                    void api.ytNavigate(`url:${url}`);
                  }}
                >
                  <Icon name="play" size={16} />
                  <span>{t("contextMenu.openChannel")}</span>
                </button>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const url = current().linkUrl!;
                    close();
                    void api.tabCreate({ isolated: false, url, activate: true }).catch(() => undefined);
                  }}
                >
                  <Icon name="plus" size={16} />
                  <span>{t("contextMenu.openNewTab")}</span>
                </button>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const url = current().linkUrl!;
                    close();
                    void api.tabCreate({ isolated: true, url, activate: true }).catch(() => undefined);
                  }}
                >
                  <Icon name="tab-isolated" size={16} />
                  <span>{t("contextMenu.openIsolatedTab")}</span>
                </button>
              </Show>

              <Show when={current().kind === "selection" && current().selectionText}>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const text = current().selectionText!;
                    close();
                    notifyCopied(text);
                  }}
                >
                  <Icon name="copy" size={16} />
                  <span>{t("contextMenu.copySelection")}</span>
                </button>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const text = current().selectionText!;
                    close();
                    void api.ytNavigate(`search:${encodeURIComponent(text)}`);
                  }}
                >
                  <Icon name="search" size={16} />
                  <span>{t("contextMenu.searchSelection")}</span>
                </button>
              </Show>

              <Show when={current().kind === "page"}>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    close();
                    void api.tabCreate({ isolated: false, activate: true }).catch(() => undefined);
                  }}
                >
                  <Icon name="plus" size={16} />
                  <span>{t("tabs.newTab")}</span>
                </button>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    close();
                    void api.tabCreate({ isolated: true, activate: true }).catch(() => undefined);
                  }}
                >
                  <Icon name="tab-isolated" size={16} />
                  <span>{t("tabs.newIsolatedTab")}</span>
                </button>
                <Show when={current().videoId && (current().currentTimeSecs ?? 0) > 0}>
                  <button
                    type="button"
                    class="yt-menu__item"
                    role="menuitem"
                    onClick={() => {
                      const url = timedUrl();
                      close();
                      if (url) notifyCopied(url);
                    }}
                  >
                    <Icon name="clock" size={16} />
                    <span>{t("contextMenu.copyLinkAtTime", { time: formatTimestamp(current().currentTimeSecs!) })}</span>
                  </button>
                </Show>
                <Show when={current().videoId}>
                  <button
                    type="button"
                    class="yt-menu__item"
                    role="menuitem"
                    onClick={() => {
                      close();
                      void api.pipOpen().catch(() => undefined);
                    }}
                  >
                    <Icon name="pip" size={16} />
                    <span>{t("contextMenu.openPip")}</span>
                  </button>
                </Show>
              </Show>
            </div>
          )}
        </Show>
      </FloatingMenu>
      <Portal>
        <div class="yt-context-toast" classList={{ "is-visible": toast() !== "" }} role="status" aria-live="polite">
          {toast()}
        </div>
      </Portal>
    </>
  );
}

export function renderYoutubeContextMenu(host: HTMLElement): void {
  render(() => <YoutubeContextMenuView />, host);
}
