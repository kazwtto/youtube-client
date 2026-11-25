import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { Portal, render } from "solid-js/web";

import { t } from "../i18n";
import { api, type AppSettings, type TabLayout, type TabSessionSnapshot, type TabState } from "../lib/api";
import { setUiElevationSource } from "../lib/elevation";
import { animateMotion, isMotionEnabled, MOTION_EASE_OUT, stopElementMotion } from "../lib/motion";
import { FloatingMenu } from "./floating-menu";
import { Icon } from "./icons";

const SIDEBAR_MIN_WIDTH = 148;
const SIDEBAR_MAX_WIDTH = 220;

function formatTabTooltip(tab: TabState): string {
  const parts = [tab.title];
  if (tab.isolated) parts.push(t("tabs.isolatedBadge"));
  if (tab.accountName) parts.push(tab.accountName);
  return parts.join(" · ");
}

function formatTabSubtitle(tab: TabState): string {
  if (tab.sleeping) return t("tabs.sleeping");
  if (tab.isPlaying) return t("tabs.playing");
  if (tab.accountName) {
    return tab.isolated
      ? `${t("tabs.isolatedBadge")} · ${tab.accountName}`
      : tab.accountName;
  }
  return tab.isolated ? t("tabs.isolatedBadge") : "";
}

function resolveYoutubeSearchOrUrl(raw: string): { url: string; isDirectUrl: boolean } {
  const trimmed = raw.trim();
  if (/^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(trimmed)) {
    return { url: trimmed, isDirectUrl: true };
  }
  return {
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(trimmed)}`,
    isDirectUrl: false,
  };
}

function handleTabKeyNavigation(
  event: KeyboardEvent,
  tabs: readonly TabState[],
  tabId: string,
  orientation: "horizontal" | "vertical",
  activate: (id: string) => void,
): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate(tabId);
    return;
  }
  const prevKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
  const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
  let targetIdx = -1;
  const currentIdx = tabs.findIndex((item) => item.id === tabId);
  if (currentIdx < 0) return;
  if (event.key === prevKey) {
    targetIdx = (currentIdx - 1 + tabs.length) % tabs.length;
  } else if (event.key === nextKey) {
    targetIdx = (currentIdx + 1) % tabs.length;
  } else if (event.key === "Home") {
    targetIdx = 0;
  } else if (event.key === "End") {
    targetIdx = tabs.length - 1;
  }
  if (targetIdx < 0) return;
  event.preventDefault();
  const nextTab = tabs[targetIdx];
  if (!nextTab) return;
  activate(nextTab.id);
  const tablist = (event.currentTarget as HTMLElement | null)?.closest('[role="tablist"]');
  const nodes = tablist?.querySelectorAll<HTMLElement>('[role="tab"]');
  nodes?.[targetIdx]?.focus();
}

function handleGlobalTabShortcut(
  event: KeyboardEvent,
  session: TabSessionSnapshot,
  actions: {
    enabled: boolean;
    layout: TabLayout;
    create: (isolated?: boolean) => void;
    reopenClosed: () => void;
    close: (tabId: string) => void;
    activate: (tabId: string) => void;
    openActionMenu: () => void;
  },
): void {
  if (!actions.enabled || !event.ctrlKey) return;
  const key = event.key.toLowerCase();
  if (key === "k" && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    actions.openActionMenu();
  } else if (key === "t" && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    actions.create(false);
  } else if (key === "t" && event.shiftKey && !event.altKey) {
    event.preventDefault();
    actions.reopenClosed();
  } else if (key === "n" && event.shiftKey && !event.altKey) {
    event.preventDefault();
    actions.create(true);
  } else if (key === "w" && !event.shiftKey && !event.altKey) {
    if (session.tabs.length > 1) {
      event.preventDefault();
      actions.close(session.activeTabId);
    }
  } else if (key === "tab" && !event.altKey) {
    event.preventDefault();
    if (actions.layout === "command") {
      actions.openActionMenu();
      return;
    }
    const tabs = session.tabs;
    if (tabs.length < 2) return;
    const idx = tabs.findIndex((item) => item.id === session.activeTabId);
    const delta = event.shiftKey ? -1 : 1;
    const next = tabs[(idx + delta + tabs.length) % tabs.length];
    if (next) actions.activate(next.id);
  } else if (/^[1-9]$/.test(key) && !event.altKey) {
    const tabs = session.tabs;
    const index = key === "9" ? tabs.length - 1 : Number(key) - 1;
    const target = tabs[index];
    if (target) {
      event.preventDefault();
      actions.activate(target.id);
    }
  }
}

function DockTabTitle(props: { title: string }) {
  let wrapperEl!: HTMLDivElement;
  let innerEl!: HTMLSpanElement;
  const [overflowPx, setOverflowPx] = createSignal(0);

  const measure = (): void => {
    if (!wrapperEl || !innerEl) return;
    const diff = Math.ceil(innerEl.scrollWidth - wrapperEl.clientWidth);
    setOverflowPx(diff > 2 ? diff : 0);
  };

  createEffect(() => {
    props.title;
    window.requestAnimationFrame(measure);
  });

  onMount(() => {
    measure();
    if (typeof ResizeObserver !== "undefined" && wrapperEl) {
      const ro = new ResizeObserver(measure);
      ro.observe(wrapperEl);
      onCleanup(() => ro.disconnect());
    }
  });

  const durationSec = (): number => Math.max(6, Math.min(18, overflowPx() / 18 + 4));

  return (
    <div
      class="tab-item__text tab-dock__marquee"
      classList={{ "is-marquee": overflowPx() > 0 }}
      ref={wrapperEl}
      style={
        overflowPx() > 0
          ? {
              "--marquee-shift": `-${overflowPx() + 14}px`,
              "--marquee-duration": `${durationSec().toFixed(2)}s`,
            }
          : undefined
      }
    >
      <span class="tab-item__title tab-dock__marquee-inner" ref={innerEl}>
        {props.title}
      </span>
    </div>
  );
}

function syncSlidingIndicator(
  listEl: HTMLDivElement | undefined,
  indicatorEl: HTMLSpanElement | undefined,
  animateTransition: boolean,
): void {
  if (!listEl || !indicatorEl) return;
  const active = listEl.querySelector<HTMLElement>('.tab-item.is-active');
  if (!active) {
    indicatorEl.style.opacity = "0";
    return;
  }
  const x = active.offsetLeft;
  const y = active.offsetTop;
  const width = active.offsetWidth;
  const height = active.offsetHeight;
  if (width <= 0 || height <= 0) return;

  indicatorEl.classList.toggle("is-isolated", active.classList.contains("is-isolated"));
  const wasReady = indicatorEl.dataset.ready === "true";
  indicatorEl.dataset.ready = "true";

  if (animateTransition && wasReady && isMotionEnabled()) {
    animateMotion(
      indicatorEl,
      { x, y, width, height, opacity: 1 },
      { duration: 0.22, ease: MOTION_EASE_OUT },
    );
  } else {
    stopElementMotion(indicatorEl, false);
    animateMotion(
      indicatorEl,
      { x, y, width, height, opacity: 1 },
      { duration: 0 },
    );
  }
}

export function TabBarView(props: { shell: HTMLElement }) {
  const [session, setSessionState] = createStore<TabSessionSnapshot>({
    tabs: [],
    activeTabId: "tab-1",
  });
  const applySession = (next: TabSessionSnapshot): void => {
    setSessionState(reconcile(next, { key: "id" }));
  };
  const [tabsEnabled, setTabsEnabled] = createSignal(true);
  const [layout, setLayout] = createSignal<TabLayout>("command");
  const [renderedBar, setRenderedBar] = createSignal<"bottom" | "sidebar" | "sidebarHover" | null>(null);
  const [barPhase, setBarPhase] = createSignal<"entering" | "visible" | "exiting">("visible");
  const [sidebarExpanded, setSidebarExpanded] = createSignal(true);
  const [sidebarWidth, setSidebarWidth] = createSignal(SIDEBAR_MAX_WIDTH);
  const [resizingSidebar, setResizingSidebar] = createSignal(false);
  const [narrowWindow, setNarrowWindow] = createSignal(
    typeof window !== "undefined" ? window.innerWidth < 720 : false,
  );
  const [peeking, setPeeking] = createSignal(false);
  const [dockPeeking, setDockPeeking] = createSignal(false);
  const [actionMenuOpen, setActionMenuOpen] = createSignal(false);
  const [actionMenuMounted, setActionMenuMounted] = createSignal(false);
  const [actionQuery, setActionQuery] = createSignal("");
  const [actionHighlight, setActionHighlight] = createSignal(0);
  const [contextTab, setContextTab] = createSignal<{ tab: TabState; x: number; y: number } | null>(null);
  const [draggingId, setDraggingId] = createSignal<string | null>(null);

  let barEl!: HTMLElement;
  let listEl!: HTMLDivElement;
  let barIndicatorEl!: HTMLSpanElement;
  let listResizeObserver: ResizeObserver | undefined;
  let actionInputEl!: HTMLInputElement;
  let peekCloseTimer: number | undefined;
  let layoutTransitionTimer: number | undefined;
  let elevationTimer: number | undefined;
  let actionElevationTimer: number | undefined;
  let wasMenuOpen = false;
  let wasActionOpen = false;
  let initializedSettings = false;
  let disposed = false;
  const unlisteners: UnlistenFn[] = [];

  createEffect(() => {
    const enabled = tabsEnabled();
    const nextLayout = layout();
    const target: "bottom" | "sidebar" | "sidebarHover" | null =
      enabled && (nextLayout === "bottom" || nextLayout === "sidebar" || nextLayout === "sidebarHover")
        ? nextLayout
        : null;

    if (layoutTransitionTimer !== undefined) {
      window.clearTimeout(layoutTransitionTimer);
      layoutTransitionTimer = undefined;
    }

    const current = renderedBar();
    if (!initializedSettings) {
      setRenderedBar(target);
      setBarPhase("visible");
      return;
    }

    if (target === current) {
      if (barPhase() === "exiting") setBarPhase("visible");
      return;
    }

    const mountTarget = (): void => {
      setRenderedBar(target);
      if ((target === "bottom" || target === "sidebar") && isMotionEnabled()) {
        setBarPhase("entering");
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (!disposed) setBarPhase("visible");
          });
        });
      } else {
        setBarPhase("visible");
      }
    };

    if ((current === "bottom" || current === "sidebar") && isMotionEnabled()) {
      setBarPhase("exiting");
      layoutTransitionTimer = window.setTimeout(() => {
        layoutTransitionTimer = undefined;
        if (!disposed) mountTarget();
      }, 250);
    } else {
      mountTarget();
    }
  });

  let lastActiveTabId = "";
  let indicatorSettleTimer: number | undefined;

  createEffect(() => {
    const activeId = session.activeTabId;
    session.tabs.map((item) => `${item.id}\0${item.title}\0${item.isolated}\0${item.isPlaying}\0${item.muted}\0${item.pinned}\0${item.sleeping}`).join("\n");
    renderedBar();
    barPhase();
    effectiveExpanded();
    const tabSwitched = lastActiveTabId !== "" && lastActiveTabId !== activeId;
    lastActiveTabId = activeId;
    window.requestAnimationFrame(() => syncSlidingIndicator(listEl, barIndicatorEl, tabSwitched));
    if (indicatorSettleTimer !== undefined) window.clearTimeout(indicatorSettleTimer);
    indicatorSettleTimer = window.setTimeout(() => {
      indicatorSettleTimer = undefined;
      if (!disposed) syncSlidingIndicator(listEl, barIndicatorEl, false);
    }, 260);
  });

  createEffect(() => {
    sidebarWidth();
    window.requestAnimationFrame(() => {
      if (!disposed) syncSlidingIndicator(listEl, barIndicatorEl, false);
    });
  });

  createEffect(() => {
    const activeLayout = renderedBar() ?? (tabsEnabled() ? layout() : "disabled");
    props.shell.dataset.tabLayout = activeLayout;
    props.shell.dataset.barPhase = barPhase();
    props.shell.dataset.sidebarExpanded = String(sidebarExpanded() && !narrowWindow());
    props.shell.classList.toggle("is-resizing-sidebar", resizingSidebar());
    props.shell.style.setProperty("--sidebar-width", `${sidebarWidth()}px`);
  });

  createEffect(() => {
    const menuOpen = contextTab() !== null;
    if (menuOpen) {
      if (elevationTimer !== undefined) {
        window.clearTimeout(elevationTimer);
        elevationTimer = undefined;
      }
      wasMenuOpen = true;
      setUiElevationSource("tabbar", true);
      return;
    }
    const shouldDelay = wasMenuOpen && isMotionEnabled();
    wasMenuOpen = false;
    if (shouldDelay) {
      if (elevationTimer !== undefined) window.clearTimeout(elevationTimer);
      elevationTimer = window.setTimeout(() => {
        elevationTimer = undefined;
        if (contextTab() === null) {
          setUiElevationSource("tabbar", false);
        }
      }, 160);
    } else {
      setUiElevationSource("tabbar", false);
    }
  });

  createEffect(() => {
    const open = actionMenuOpen();
    if (open) {
      if (actionElevationTimer !== undefined) {
        window.clearTimeout(actionElevationTimer);
        actionElevationTimer = undefined;
      }
      wasActionOpen = true;
      setActionMenuMounted(true);
      setUiElevationSource("action-menu", true);
      window.requestAnimationFrame(() => {
        actionInputEl?.focus();
        actionInputEl?.select();
      });
      return;
    }
    const shouldDelay = wasActionOpen && isMotionEnabled();
    wasActionOpen = false;
    if (shouldDelay) {
      if (actionElevationTimer !== undefined) window.clearTimeout(actionElevationTimer);
      actionElevationTimer = window.setTimeout(() => {
        actionElevationTimer = undefined;
        if (!actionMenuOpen()) {
          setActionMenuMounted(false);
          setUiElevationSource("action-menu", false);
        }
      }, 230);
    } else {
      setActionMenuMounted(false);
      setUiElevationSource("action-menu", false);
    }
  });

  const openActionMenu = (): void => {
    if (!tabsEnabled()) return;
    setActionQuery("");
    setActionHighlight(0);
    setActionMenuOpen(true);
  };

  const closeActionMenu = (): void => {
    setActionMenuOpen(false);
    setContextTab(null);
  };

  const onDocumentMouseMove = (event: MouseEvent): void => {
    if (!tabsEnabled()) return;
    if (layout() === "sidebarHover" && peeking() && contextTab() === null && event.clientX > 248) {
      setPeeking(false);
      void api.tabSidebarPeek(false).catch(() => undefined);
    }
    if (layout() === "floating" && contextTab() === null) {
      const midX = window.innerWidth / 2;
      const bottomZoneHalf = Math.min(180, window.innerWidth * 0.24);
      const fromBottom = window.innerHeight - event.clientY;
      const inBottomZone = fromBottom <= 22 && Math.abs(event.clientX - midX) <= bottomZoneHalf;
      if (inBottomZone && !dockPeeking()) {
        setDockPeeking(true);
        void api.tabDockPeek(true).catch(() => undefined);
      } else if (fromBottom > 76 && dockPeeking()) {
        setDockPeeking(false);
        void api.tabDockPeek(false).catch(() => undefined);
      }
    }
  };

  const cancelPeekClose = (): void => {
    if (peekCloseTimer !== undefined) {
      window.clearTimeout(peekCloseTimer);
      peekCloseTimer = undefined;
    }
  };

  const schedulePeekClose = (): void => {
    if (!tabsEnabled() || layout() !== "sidebarHover") return;
    if (contextTab() !== null) return;
    cancelPeekClose();
    peekCloseTimer = window.setTimeout(() => {
      peekCloseTimer = undefined;
      if (contextTab() === null) {
        setPeeking(false);
        void api.tabSidebarPeek(false).catch(() => undefined);
      }
    }, 340);
  };

  const openPeek = (): void => {
    if (!tabsEnabled() || layout() !== "sidebarHover") return;
    cancelPeekClose();
    if (!peeking()) {
      setPeeking(true);
      void api.tabSidebarPeek(true).catch(() => undefined);
    }
  };

  const toggleSidebarExpanded = (): void => {
    const nextExpanded = !sidebarExpanded();
    setSidebarExpanded(nextExpanded);
    void api.setSidebarWidth(sidebarWidth(), nextExpanded, true).catch(() => undefined);
  };

  const startSidebarResize = (event: PointerEvent): void => {
    if (layout() !== "sidebar") return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    setResizingSidebar(true);
    let pendingFrame = 0;
    let latestWidth = sidebarWidth();
    let latestExpanded = sidebarExpanded();

    const flush = (): void => {
      pendingFrame = 0;
      void api.setSidebarWidth(latestWidth, latestExpanded, false).catch(() => undefined);
    };

    const onMove = (moveEvent: PointerEvent): void => {
      const x = moveEvent.clientX;
      if (x < 104) {
        latestExpanded = false;
        setSidebarExpanded(false);
      } else {
        latestExpanded = true;
        latestWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(x)));
        setSidebarExpanded(true);
        setSidebarWidth(latestWidth);
      }
      if (!pendingFrame) {
        pendingFrame = window.requestAnimationFrame(flush);
      }
    };

    const onUp = (upEvent: PointerEvent): void => {
      if (pendingFrame) {
        window.cancelAnimationFrame(pendingFrame);
        pendingFrame = 0;
      }
      setResizingSidebar(false);
      handle.releasePointerCapture(upEvent.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      void api.setSidebarWidth(latestWidth, latestExpanded, true).catch(() => undefined);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const ensureYoutubeHome = (): void => {
    const content = props.shell.querySelector<HTMLElement>(".content");
    if (content?.dataset.youtube !== "true") {
      document.dispatchEvent(new CustomEvent("app:navigate", { detail: "home" }));
    }
  };

  const createNewTab = (isolated?: boolean, url?: string): void => {
    ensureYoutubeHome();
    void api.tabCreate({ isolated, url, activate: true }).then(applySession).catch(() => undefined);
  };

  const activateTab = (tabId: string): void => {
    ensureYoutubeHome();
    void api.tabActivate(tabId).then(applySession).catch(() => undefined);
  };

  const closeTab = (tabId: string, event?: MouseEvent): void => {
    event?.stopPropagation();
    void api.tabClose(tabId).then(applySession).catch(() => undefined);
  };

  const toggleMute = (tab: TabState, event: MouseEvent): void => {
    event.stopPropagation();
    void api.tabSetMuted(tab.id, !tab.muted).then(applySession).catch(() => undefined);
  };

  const handleDropOnTab = (targetId: string): void => {
    const sourceId = draggingId();
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = session.tabs.map((item) => item.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    void api.tabReorder(ids).then(applySession).catch(() => undefined);
  };

  const onGlobalKeyDown = (event: KeyboardEvent): void => {
    if (actionMenuOpen() && event.key === "Escape") {
      event.preventDefault();
      closeActionMenu();
      return;
    }
    handleGlobalTabShortcut(event, session, {
      enabled: tabsEnabled(),
      layout: layout(),
      create: (isolated) => createNewTab(isolated),
      reopenClosed: () => void api.tabReopenClosed().then(applySession).catch(() => undefined),
      close: (tabId) => void api.tabClose(tabId).then(applySession).catch(() => undefined),
      activate: (tabId) => activateTab(tabId),
      openActionMenu: () => {
        if (actionMenuOpen()) closeActionMenu();
        else openActionMenu();
      },
    });
  };

  const onDocumentMouseLeave = (): void => {
    if (layout() === "sidebarHover" && peeking() && contextTab() === null) {
      setPeeking(false);
      void api.tabSidebarPeek(false).catch(() => undefined);
    }
  };

  const onOpenActionMenuEvent = (): void => {
    if (actionMenuOpen()) closeActionMenu();
    else openActionMenu();
  };

  onMount(() => {
    void api.tabsSnapshot().then(applySession).catch(() => undefined);
    void api
      .settingsGet()
      .then((settings) => {
        setTabsEnabled(settings.tabs?.enabled ?? true);
        setLayout(settings.tabs?.layout ?? "command");
        setSidebarExpanded(settings.tabs?.sidebarExpanded ?? true);
        setSidebarWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, settings.tabs?.sidebarWidth ?? SIDEBAR_MAX_WIDTH)));
        initializedSettings = true;
      })
      .catch(() => {
        initializedSettings = true;
      });

    const register = (promise: Promise<UnlistenFn>): void => {
      void promise
        .then((stop) => {
          if (disposed) stop();
          else unlisteners.push(stop);
        })
        .catch(() => undefined);
    };

    register(
      listen<TabSessionSnapshot>("tabs://updated", (event) => {
        if (event.payload) applySession(event.payload);
      }),
    );
    register(
      listen<boolean>("tabs://sidebar-peek", (event) => {
        setPeeking(Boolean(event.payload));
      }),
    );
    register(
      listen<boolean>("tabs://dock-peek", (event) => {
        setDockPeeking(Boolean(event.payload));
      }),
    );
    register(
      listen<boolean>("tabs://open-action-menu", () => {
        if (!tabsEnabled()) return;
        if (actionMenuOpen()) closeActionMenu();
        else openActionMenu();
      }),
    );
    register(
      listen<{ tabId: string; x: number; y: number }>("tabs://open-context-menu", (event) => {
        if (!event.payload) return;
        const target = session.tabs.find((item) => item.id === event.payload.tabId);
        if (target) setContextTab({ tab: target, x: event.payload.x, y: event.payload.y });
      }),
    );
    register(
      listen<AppSettings>("settings://changed", (event) => {
        if (event.payload?.tabs) {
          const nextEnabled = event.payload.tabs.enabled ?? true;
          setTabsEnabled(nextEnabled);
          setLayout(event.payload.tabs.layout);
          setSidebarExpanded(event.payload.tabs.sidebarExpanded);
          setSidebarWidth(
            Math.max(
              SIDEBAR_MIN_WIDTH,
              Math.min(SIDEBAR_MAX_WIDTH, event.payload.tabs.sidebarWidth ?? SIDEBAR_MAX_WIDTH),
            ),
          );
          if (!nextEnabled || event.payload.tabs.layout !== "sidebarHover") setPeeking(false);
          if (!nextEnabled || event.payload.tabs.layout !== "floating") setDockPeeking(false);
          if (!nextEnabled) setActionMenuOpen(false);
        }
      }),
    );

    const onWindowResize = (): void => syncSlidingIndicator(listEl, barIndicatorEl, false);
    window.addEventListener("resize", onWindowResize);
    if (typeof ResizeObserver !== "undefined") {
      listResizeObserver = new ResizeObserver(() => {
        syncSlidingIndicator(listEl, barIndicatorEl, false);
      });
      if (listEl) listResizeObserver.observe(listEl);
    }

    const media = window.matchMedia("(max-width: 720px)");
    const onMediaChange = (): void => {
      setNarrowWindow(media.matches);
    };
    onMediaChange();
    media.addEventListener("change", onMediaChange);

    document.addEventListener("keydown", onGlobalKeyDown);
    document.addEventListener("mousemove", onDocumentMouseMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onDocumentMouseLeave);
    document.addEventListener("app:open-tab-action-menu", onOpenActionMenuEvent);
    onCleanup(() => {
      disposed = true;
      cancelPeekClose();
      window.removeEventListener("resize", onWindowResize);
      listResizeObserver?.disconnect();
      if (indicatorSettleTimer !== undefined) window.clearTimeout(indicatorSettleTimer);
      media.removeEventListener("change", onMediaChange);
      if (layoutTransitionTimer !== undefined) window.clearTimeout(layoutTransitionTimer);
      if (elevationTimer !== undefined) window.clearTimeout(elevationTimer);
      if (actionElevationTimer !== undefined) window.clearTimeout(actionElevationTimer);
      setUiElevationSource("tabbar", false);
      setUiElevationSource("action-menu", false);
      props.shell.classList.remove("is-resizing-sidebar");
      document.removeEventListener("keydown", onGlobalKeyDown);
      document.removeEventListener("mousemove", onDocumentMouseMove);
      document.documentElement.removeEventListener("mouseleave", onDocumentMouseLeave);
      document.removeEventListener("app:open-tab-action-menu", onOpenActionMenuEvent);
      for (const stop of unlisteners) stop();
    });
  });

  const isSidebar = (): boolean => renderedBar() === "sidebar" || renderedBar() === "sidebarHover";
  const effectiveExpanded = (): boolean => sidebarExpanded() && !narrowWindow();
  const showLabels = (): boolean => renderedBar() === "bottom" || renderedBar() === "sidebarHover" || effectiveExpanded();
  const canCloseAny = (): boolean => session.tabs.length > 1;
  const hasMultipleTabs = (): boolean => session.tabs.length > 1;
  const showBarAside = (): boolean => renderedBar() !== null;

  const filteredActionTabs = createMemo(() => {
    if (session.tabs.length <= 1) return [];
    const q = actionQuery().trim().toLowerCase();
    if (!q) return session.tabs;
    return session.tabs.filter(
      (tab) =>
        tab.title.toLowerCase().includes(q) ||
        tab.url.toLowerCase().includes(q) ||
        (tab.accountName ?? "").toLowerCase().includes(q),
    );
  });

  const hasSearchAction = (): boolean => actionQuery().trim().length > 0;

  const executeActionSearch = (isolated = false): void => {
    const q = actionQuery().trim();
    if (!q) return;
    const { url } = resolveYoutubeSearchOrUrl(q);
    closeActionMenu();
    createNewTab(isolated, url);
  };

  const onActionInputKeyDown = (event: KeyboardEvent): void => {
    const hasSearch = hasSearchAction();
    const tabs = filteredActionTabs();
    const total = (hasSearch ? 1 : 0) + tabs.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (total > 0) setActionHighlight((prev) => (prev + 1) % total);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (total > 0) setActionHighlight((prev) => (prev - 1 + total) % total);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const idx = actionHighlight();
      if (hasSearch && idx === 0) {
        executeActionSearch(event.shiftKey);
        return;
      }
      const tabIdx = hasSearch ? idx - 1 : idx;
      const target = tabs[tabIdx];
      if (target) {
        closeActionMenu();
        activateTab(target.id);
      } else if (hasSearch) {
        executeActionSearch(event.shiftKey);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeActionMenu();
    }
  };

  const contextAnchor = createMemo(() => {
    const ctx = contextTab();
    if (!ctx) return undefined;
    return {
      getBoundingClientRect: () => DOMRect.fromRect({ x: ctx.x, y: ctx.y, width: 0, height: 0 }),
    };
  });

  return (
    <>
      <Show when={tabsEnabled() && layout() === "sidebarHover"}>
        <div class="tab-hover-trigger" onMouseEnter={openPeek} aria-hidden="true" />
      </Show>

      <Show when={tabsEnabled() && layout() === "floating"}>
        <div
          class="tab-dock-trigger"
          onMouseEnter={() => {
            setDockPeeking(true);
            void api.tabDockPeek(true).catch(() => undefined);
          }}
          aria-hidden="true"
        />
      </Show>

      <Show when={showBarAside()}>
        <aside
          class="tab-bar"
          classList={{
            "tab-bar--bottom": renderedBar() === "bottom",
            "tab-bar--sidebar": renderedBar() === "sidebar",
            "tab-bar--sidebar-hover": renderedBar() === "sidebarHover",
            "tab-bar--collapsed": renderedBar() === "sidebar" && !effectiveExpanded(),
            "tab-bar--peeking": renderedBar() === "sidebarHover" && peeking(),
            "tab-bar--resizing": resizingSidebar(),
            "tab-bar--entering": barPhase() === "entering",
            "tab-bar--exiting": barPhase() === "exiting",
          }}
          aria-label={t("tabs.title")}
          ref={(el) => {
            barEl = el;
          }}
          onMouseEnter={cancelPeekClose}
          onMouseLeave={schedulePeekClose}
        >
          <div
            class="tab-bar__list"
            role="tablist"
            aria-orientation={isSidebar() ? "vertical" : "horizontal"}
            ref={(el) => {
              listEl = el;
              if (el) {
                listResizeObserver?.disconnect();
                listResizeObserver?.observe(el);
                window.requestAnimationFrame(() => syncSlidingIndicator(el, barIndicatorEl, false));
              }
            }}
            onWheel={(event) => {
              if (layout() === "bottom" && Math.abs(event.deltaY) > Math.abs(event.deltaX) && listEl) {
                listEl.scrollLeft += event.deltaY;
              }
            }}
          >
            <Show when={hasMultipleTabs()}>
              <span class="tab-list__indicator" ref={(el) => { barIndicatorEl = el; }} aria-hidden="true" />
              <For each={session.tabs}>
              {(tab) => {
                const isActive = (): boolean => session.activeTabId === tab.id;
                const subtitle = (): string => formatTabSubtitle(tab);

                return (
                  <div
                    class="tab-item"
                    classList={{
                      "is-active": isActive(),
                      "is-isolated": tab.isolated,
                      "is-pinned": tab.pinned,
                      "is-sleeping": tab.sleeping,
                      "is-playing": tab.isPlaying,
                    }}
                    role="tab"
                    aria-selected={isActive()}
                    tabIndex={isActive() ? 0 : -1}
                    title={formatTabTooltip(tab)}
                    draggable={true}
                    onDragStart={() => setDraggingId(tab.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleDropOnTab(tab.id)}
                    onKeyDown={(event) =>
                      handleTabKeyNavigation(
                        event,
                        session.tabs,
                        tab.id,
                        isSidebar() ? "vertical" : "horizontal",
                        activateTab,
                      )
                    }
                    onMouseDown={(event) => {
                      if (event.button === 1 && !tab.pinned && canCloseAny()) {
                        event.preventDefault();
                        closeTab(tab.id);
                      }
                    }}
                    onClick={() => activateTab(tab.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextTab({ tab, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <Show when={renderedBar() === "sidebar" && isActive()}>
                      <span class="tab-item__active-bar" classList={{ "is-isolated": tab.isolated }} aria-hidden="true" />
                    </Show>
                    <Show when={renderedBar() === "sidebarHover" && isActive()}>
                      <span class="tab-dock__dot" classList={{ "is-isolated": tab.isolated }} aria-hidden="true" />
                    </Show>
                    <span class="tab-item__leading" classList={{ "has-avatar": tab.isolated && Boolean(tab.avatarUrl) }}>
                      <Show
                        when={tab.isolated}
                        fallback={<Icon name="brand" source="youtube" size={17} class="tab-item__yt-brand" />}
                      >
                        <Show
                          when={tab.avatarUrl}
                          fallback={<Icon name="tab-isolated" size={15} class="tab-item__isolated-icon" />}
                        >
                          <img src={tab.avatarUrl!} alt="" referrerpolicy="no-referrer" />
                          <span class="tab-item__isolated-pip" aria-hidden="true" />
                        </Show>
                      </Show>
                    </span>

                    <Show when={showLabels()}>
                      <div class="tab-item__text">
                        <span class="tab-item__title">{tab.title}</span>
                        <Show when={isSidebar() && subtitle()}>
                          <span class="tab-item__meta">{subtitle()}</span>
                        </Show>
                      </div>
                    </Show>

                    <Show when={showLabels() && tab.sleeping}>
                      <span class="tab-item__sleep-badge" title={t("tabs.sleeping")} aria-label={t("tabs.sleeping")}>
                        <Icon name="sleep" size={12} />
                      </span>
                    </Show>

                    <Show when={showLabels() && (tab.isPlaying || tab.muted)}>
                      <button
                        type="button"
                        class="tab-item__mute"
                        classList={{ "is-muted": tab.muted }}
                        title={t(tab.muted ? "tabs.unmute" : "tabs.mute")}
                        aria-label={t(tab.muted ? "tabs.unmute" : "tabs.mute")}
                        onClick={(event) => toggleMute(tab, event)}
                      >
                        <Show
                          when={!tab.muted && tab.isPlaying}
                          fallback={<Icon name={tab.muted ? "volume-mute" : "volume"} size={13} />}
                        >
                          <span class="tab-item__equalizer" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                        </Show>
                      </button>
                    </Show>

                    <Show when={showLabels() && !tab.pinned && canCloseAny()}>
                      <button
                        type="button"
                        class="tab-item__close"
                        title={t("tabs.closeTab")}
                        aria-label={t("tabs.closeTab")}
                        onClick={(event) => closeTab(tab.id, event)}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </Show>
                  </div>
                );
              }}
              </For>
            </Show>
          </div>

          <div class="tab-bar__actions">
            <button
              type="button"
              class="tab-bar__btn"
              title={t("tabs.newTab")}
              aria-label={t("tabs.newTab")}
              onClick={() => createNewTab()}
            >
              <Icon name="plus" size={16} />
              <Show when={isSidebar() && showLabels()}><span>{t("tabs.newTab")}</span></Show>
            </button>

            <button
              type="button"
              class="tab-bar__btn tab-bar__btn--isolated"
              title={t("tabs.newIsolatedTab")}
              aria-label={t("tabs.newIsolatedTab")}
              onClick={() => createNewTab(true)}
            >
              <Icon name="tab-isolated" size={16} />
              <Show when={isSidebar() && showLabels()}><span>{t("tabs.newIsolatedTab")}</span></Show>
            </button>

            <Show when={renderedBar() === "sidebar"}>
              <button
                type="button"
                class="tab-bar__btn"
                title={t(sidebarExpanded() ? "tabs.collapseSidebar" : "tabs.expandSidebar")}
                aria-label={t(sidebarExpanded() ? "tabs.collapseSidebar" : "tabs.expandSidebar")}
                onClick={toggleSidebarExpanded}
              >
                <Icon name="sidebar" size={16} />
                <Show when={showLabels()}>
                  <span>{t(sidebarExpanded() ? "tabs.collapseSidebar" : "tabs.expandSidebar")}</span>
                </Show>
              </button>
            </Show>
          </div>

          <Show when={renderedBar() === "sidebar"}>
            <div
              class="tab-bar__resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("tabs.resizeSidebar")}
              title={t("tabs.resizeSidebar")}
              onPointerDown={startSidebarResize}
            />
          </Show>
        </aside>
      </Show>

      <Portal>
        <div
          class="tab-action-backdrop"
          classList={{ "is-open": actionMenuOpen() }}
          aria-hidden={!actionMenuOpen()}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeActionMenu();
          }}
        >
          <Show when={actionMenuMounted()}>
            <div
              class="tab-action-modal"
              role="dialog"
              aria-modal="true"
              aria-label={t("tabs.actionMenuTitle")}
            >
              <div class="tab-action-modal__search">
                <Icon name="search" size={16} class="tab-action-modal__search-icon" />
                <input
                  ref={actionInputEl}
                  type="search"
                  class="tab-action-modal__input"
                  value={actionQuery()}
                  placeholder={t("tabs.actionMenuPlaceholder")}
                  autocomplete="off"
                  spellcheck={false}
                  onInput={(event) => {
                    setActionQuery(event.currentTarget.value);
                    setActionHighlight(0);
                  }}
                  onKeyDown={onActionInputKeyDown}
                />
                <div class="tab-action-modal__quick">
                  <button
                    type="button"
                    class="tab-action-modal__icon-btn"
                    title={t("tabs.newTab")}
                    aria-label={t("tabs.newTab")}
                    onClick={() => {
                      closeActionMenu();
                      createNewTab(false);
                    }}
                  >
                    <Icon name="plus" size={16} />
                  </button>
                  <button
                    type="button"
                    class="tab-action-modal__icon-btn tab-bar__btn--isolated"
                    title={t("tabs.newIsolatedTab")}
                    aria-label={t("tabs.newIsolatedTab")}
                    onClick={() => {
                      closeActionMenu();
                      createNewTab(true);
                    }}
                  >
                    <Icon name="tab-isolated" size={16} />
                  </button>
                  <button
                    type="button"
                    class="tab-action-modal__icon-btn"
                    title={t("tabs.reopenClosed")}
                    aria-label={t("tabs.reopenClosed")}
                    onClick={() => {
                      closeActionMenu();
                      void api.tabReopenClosed().then(applySession).catch(() => undefined);
                    }}
                  >
                    <Icon name="history" size={16} />
                  </button>
                </div>
              </div>

              <Show when={hasSearchAction() || filteredActionTabs().length > 0}>
                <div class="tab-action-modal__list" role="listbox" aria-label={t("tabs.title")}>
                <Show when={hasSearchAction()}>
                  {(() => {
                    const resolved = () => resolveYoutubeSearchOrUrl(actionQuery());
                    return (
                      <button
                        type="button"
                        class="tab-action-row tab-action-row--search"
                        classList={{ "is-highlighted": actionHighlight() === 0 }}
                        role="option"
                        aria-selected={actionHighlight() === 0}
                        onMouseEnter={() => setActionHighlight(0)}
                        onClick={() => executeActionSearch(false)}
                      >
                        <span class="tab-action-row__leading">
                          <Icon name="search" size={16} />
                        </span>
                        <span class="tab-action-row__text">
                          <span class="tab-action-row__title">
                            {resolved().isDirectUrl
                              ? t("tabs.actionMenuOpenUrlNewTab")
                              : t("tabs.actionMenuSearchNewTab", { query: actionQuery().trim() })}
                          </span>
                        </span>
                        <kbd class="tab-action-modal__kbd">Enter</kbd>
                      </button>
                    );
                  })()}
                </Show>

                <Show
                  when={filteredActionTabs().length > 0}
                  fallback={
                    <Show when={!hasSearchAction()}>
                      <p class="tab-action-modal__empty">{t("tabs.actionMenuEmpty")}</p>
                    </Show>
                  }
                >
                  <For each={filteredActionTabs()}>
                    {(tab, index) => {
                      const rowIdx = (): number => (hasSearchAction() ? index() + 1 : index());
                      const isActive = (): boolean => session.activeTabId === tab.id;
                      const subtitle = (): string => formatTabSubtitle(tab);
                      return (
                        <div
                          class="tab-action-row"
                          classList={{
                            "is-active": isActive(),
                            "is-highlighted": actionHighlight() === rowIdx(),
                            "is-isolated": tab.isolated,
                            "is-sleeping": tab.sleeping,
                          }}
                          role="option"
                          aria-selected={isActive()}
                          draggable={true}
                          onDragStart={() => setDraggingId(tab.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => handleDropOnTab(tab.id)}
                          onMouseEnter={() => setActionHighlight(rowIdx())}
                          onClick={() => {
                            closeActionMenu();
                            activateTab(tab.id);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setContextTab({ tab, x: event.clientX, y: event.clientY });
                          }}
                        >
                          <span class="tab-item__leading" classList={{ "has-avatar": tab.isolated && Boolean(tab.avatarUrl) }}>
                            <Show
                              when={tab.isolated}
                              fallback={<Icon name="brand" source="youtube" size={17} class="tab-item__yt-brand" />}
                            >
                              <Show
                                when={tab.avatarUrl}
                                fallback={<Icon name="tab-isolated" size={15} class="tab-item__isolated-icon" />}
                              >
                                <img src={tab.avatarUrl!} alt="" referrerpolicy="no-referrer" />
                                <span class="tab-item__isolated-pip" aria-hidden="true" />
                              </Show>
                            </Show>
                          </span>
                          <div class="tab-action-row__text">
                            <span class="tab-action-row__title">{tab.title}</span>
                            <Show when={subtitle()}>
                              <span class="tab-action-row__meta">{subtitle()}</span>
                            </Show>
                          </div>
                          <Show when={tab.sleeping}>
                            <span class="tab-item__sleep-badge" title={t("tabs.sleeping")} aria-label={t("tabs.sleeping")}>
                              <Icon name="sleep" size={13} />
                            </span>
                          </Show>
                          <div class="tab-action-row__controls">
                            <button
                              type="button"
                              class="tab-action-row__btn"
                              classList={{ "is-muted": tab.muted }}
                              title={t(tab.muted ? "tabs.unmute" : "tabs.mute")}
                              aria-label={t(tab.muted ? "tabs.unmute" : "tabs.mute")}
                              onClick={(event) => toggleMute(tab, event)}
                            >
                              <Icon name={tab.muted ? "volume-mute" : "volume"} size={14} />
                            </button>
                            <button
                              type="button"
                              class="tab-action-row__btn"
                              classList={{ "is-on": tab.pinned }}
                              title={t(tab.pinned ? "tabs.unpin" : "tabs.pin")}
                              aria-label={t(tab.pinned ? "tabs.unpin" : "tabs.pin")}
                              onClick={(event) => {
                                event.stopPropagation();
                                void api.tabSetPinned(tab.id, !tab.pinned).then(applySession).catch(() => undefined);
                              }}
                            >
                              <Icon name="pin" size={14} />
                            </button>
                            <button
                              type="button"
                              class="tab-action-row__btn"
                              title={t("tabs.duplicate")}
                              aria-label={t("tabs.duplicate")}
                              onClick={(event) => {
                                event.stopPropagation();
                                void api.tabDuplicate(tab.id).then(applySession).catch(() => undefined);
                              }}
                            >
                              <Icon name="plus" size={14} />
                            </button>
                            <Show when={!tab.pinned && canCloseAny()}>
                              <button
                                type="button"
                                class="tab-action-row__btn"
                                title={t("tabs.closeTab")}
                                aria-label={t("tabs.closeTab")}
                                onClick={(event) => closeTab(tab.id, event)}
                              >
                                <Icon name="close" size={13} />
                              </button>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </Show>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Portal>

      <FloatingMenu
        open={() => contextTab() !== null}
        anchor={contextAnchor}
        placement={layout() === "bottom" || layout() === "floating" ? "top-start" : "right-start"}
        width={244}
        ariaLabel={t("tabs.title")}
        onClose={() => {
          setContextTab(null);
          if (barEl && !barEl.matches(":hover")) schedulePeekClose();
          if (layout() === "floating") {
            setDockPeeking(false);
            void api.tabDockPeek(false).catch(() => undefined);
          }
        }}
      >
        <Show when={contextTab()}>
          {(ctx) => {
            const tab = (): TabState => ctx().tab;
            return (
              <div class="yt-menu__body">
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const target = tab();
                    setContextTab(null);
                    void api.tabActivate(target.id)
                      .then(() => api.ytNavigate("reload"))
                      .catch(() => undefined);
                  }}
                >
                  <Icon name="reload" size={16} />
                  <span>{t("titlebar.reload")}</span>
                </button>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const target = tab();
                    setContextTab(null);
                    void api.tabDuplicate(target.id).then(applySession).catch(() => undefined);
                  }}
                >
                  <Icon name="plus" size={16} />
                  <span>{t("tabs.duplicate")}</span>
                </button>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const target = tab();
                    setContextTab(null);
                    void api.tabDuplicate(target.id, true).then(applySession).catch(() => undefined);
                  }}
                >
                  <Icon name="tab-isolated" size={16} />
                  <span>{t("tabs.duplicateIsolated")}</span>
                </button>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const target = tab();
                    setContextTab(null);
                    void api.tabSetPinned(target.id, !target.pinned).then(applySession).catch(() => undefined);
                  }}
                >
                  <Icon name="pin" size={16} />
                  <span>{t(tab().pinned ? "tabs.unpin" : "tabs.pin")}</span>
                </button>
                <button
                  type="button"
                  class="yt-menu__item"
                  role="menuitem"
                  onClick={() => {
                    const target = tab();
                    setContextTab(null);
                    void api.tabSetMuted(target.id, !target.muted).then(applySession).catch(() => undefined);
                  }}
                >
                  <Icon name={tab().muted ? "volume" : "volume-mute"} size={16} />
                  <span>{t(tab().muted ? "tabs.unmute" : "tabs.mute")}</span>
                </button>
                <Show when={session.activeTabId !== tab().id && !tab().sleeping}>
                  <button
                    type="button"
                    class="yt-menu__item"
                    role="menuitem"
                    onClick={() => {
                      const target = tab();
                      setContextTab(null);
                      void api.tabSleep(target.id).then(applySession).catch(() => undefined);
                    }}
                  >
                    <Icon name="clock" size={16} />
                    <span>{t("tabs.sleep")}</span>
                  </button>
                </Show>
                <Show when={canCloseAny()}>
                  <div class="yt-menu__divider" />
                  <button
                    type="button"
                    class="yt-menu__item"
                    role="menuitem"
                    onClick={() => {
                      const target = tab();
                      setContextTab(null);
                      void api.tabCloseOthers(target.id).then(applySession).catch(() => undefined);
                    }}
                  >
                    <Icon name="close" size={16} />
                    <span>{t("tabs.closeOthers")}</span>
                  </button>
                  <Show when={!tab().pinned}>
                    <button
                      type="button"
                      class="yt-menu__item"
                      role="menuitem"
                      onClick={() => {
                        const target = tab();
                        setContextTab(null);
                        closeTab(target.id);
                      }}
                    >
                      <Icon name="trash" size={16} />
                      <span>{t("tabs.closeTab")}</span>
                    </button>
                  </Show>
                </Show>
              </div>
            );
          }}
        </Show>
      </FloatingMenu>
    </>
  );
}

function TabDockView() {
  const [session, setSessionState] = createStore<TabSessionSnapshot>({
    tabs: [],
    activeTabId: "tab-1",
  });
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  const [peeking, setPeeking] = createSignal(false);
  let dockEl!: HTMLDivElement;
  let listEl!: HTMLDivElement;
  let dockIndicatorEl!: HTMLSpanElement;
  let actionsEl!: HTMLDivElement;
  let hideTimer: number | undefined;
  let disposed = false;
  let resizeObserver: ResizeObserver | undefined;
  const unlisteners: UnlistenFn[] = [];

  const cancelHide = (): void => {
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  };

  const scheduleHide = (): void => {
    cancelHide();
    hideTimer = window.setTimeout(() => {
      hideTimer = undefined;
      setPeeking(false);
      void api.tabDockPeek(false).catch(() => undefined);
    }, 320);
  };

  let lastSentDockWidth = 0;
  let lastDockActiveTabId = "";

  const hasMultipleTabs = (): boolean => session.tabs.length > 1;

  const syncDockWidth = (): void => {
    if (!dockEl) return;
    const actionsW = actionsEl ? actionsEl.offsetWidth : 64;
    const width = hasMultipleTabs()
      ? Math.max(168, Math.ceil((listEl ? listEl.scrollWidth : 0) + actionsW + 64))
      : Math.max(120, Math.ceil(actionsW + 32));
    if (width === lastSentDockWidth) return;
    lastSentDockWidth = width;
    void api.setTabDockWidth(width).catch(() => undefined);
  };

  const applySession = (next: TabSessionSnapshot): void => {
    setSessionState(reconcile(next, { key: "id" }));
  };

  createEffect(() => {
    const activeId = session.activeTabId;
    session.tabs.map((item) => `${item.id}\0${item.title}\0${item.isolated}\0${item.isPlaying}\0${item.muted}\0${item.pinned}\0${item.sleeping}`).join("\n");
    const tabSwitched = lastDockActiveTabId !== "" && lastDockActiveTabId !== activeId;
    lastDockActiveTabId = activeId;
    window.requestAnimationFrame(() => {
      if (disposed) return;
      syncDockWidth();
      syncSlidingIndicator(listEl, dockIndicatorEl, tabSwitched);
    });
  });

  const handleDropOnTab = (targetId: string): void => {
    const sourceId = draggingId();
    setDraggingId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = session.tabs.map((item) => item.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    void api.tabReorder(ids).then(applySession).catch(() => undefined);
  };

  const onGlobalKeyDown = (event: KeyboardEvent): void => {
    handleGlobalTabShortcut(event, session, {
      enabled: true,
      layout: "floating",
      create: (isolated) => void api.tabCreate({ isolated, activate: true }).then(applySession).catch(() => undefined),
      reopenClosed: () => void api.tabReopenClosed().then(applySession).catch(() => undefined),
      close: (tabId) => void api.tabClose(tabId).then(applySession).catch(() => undefined),
      activate: (tabId) => void api.tabActivate(tabId).then(applySession).catch(() => undefined),
      openActionMenu: () => void api.tabOpenActionMenu().catch(() => undefined),
    });
  };

  onMount(() => {
    void api.tabsSnapshot().then(applySession).catch(() => undefined);
    void listen<TabSessionSnapshot>("tabs://updated", (event) => {
      if (event.payload) applySession(event.payload);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisteners.push(stop);
      })
      .catch(() => undefined);

    void listen<boolean>("tabs://dock-peek", (event) => {
      const next = Boolean(event.payload);
      if (next) cancelHide();
      setPeeking(next);
      if (next) window.requestAnimationFrame(syncDockWidth);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisteners.push(stop);
      })
      .catch(() => undefined);

    if ((dockEl || listEl) && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        syncDockWidth();
        syncSlidingIndicator(listEl, dockIndicatorEl, false);
      });
      if (dockEl) resizeObserver.observe(dockEl);
      if (listEl) resizeObserver.observe(listEl);
    }
    syncDockWidth();
    document.addEventListener("keydown", onGlobalKeyDown);

    onCleanup(() => {
      disposed = true;
      cancelHide();
      resizeObserver?.disconnect();
      document.removeEventListener("keydown", onGlobalKeyDown);
      for (const stop of unlisteners) stop();
    });
  });

  const canCloseAny = (): boolean => session.tabs.length > 1;

  return (
    <div
      class="tab-dock-viewport"
      onContextMenu={(event) => event.preventDefault()}
      onMouseEnter={() => {
        cancelHide();
        setPeeking(true);
      }}
      onMouseLeave={scheduleHide}
    >
      <div class="tab-dock" classList={{ "is-peeking": peeking() }} ref={dockEl}>
        <Show when={hasMultipleTabs()}>
          <div
            class="tab-dock__list"
            role="tablist"
            aria-orientation="horizontal"
            ref={listEl}
            onWheel={(event) => {
              if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && listEl) {
                listEl.scrollLeft += event.deltaY;
              }
            }}
          >
            <span class="tab-list__indicator" ref={dockIndicatorEl} aria-hidden="true" />
            <For each={session.tabs}>
            {(tab) => {
              const isActive = (): boolean => session.activeTabId === tab.id;
              return (
                <div
                  class="tab-item"
                  classList={{
                    "is-active": isActive(),
                    "is-isolated": tab.isolated,
                    "is-pinned": tab.pinned,
                    "is-sleeping": tab.sleeping,
                    "is-playing": tab.isPlaying,
                  }}
                  role="tab"
                  aria-selected={isActive()}
                  tabIndex={isActive() ? 0 : -1}
                  title={formatTabTooltip(tab)}
                  draggable={true}
                  onDragStart={() => setDraggingId(tab.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDropOnTab(tab.id)}
                  onKeyDown={(event) =>
                    handleTabKeyNavigation(event, session.tabs, tab.id, "horizontal", (id) => {
                      void api.tabActivate(id).then(applySession).catch(() => undefined);
                    })
                  }
                  onMouseDown={(event) => {
                    if (event.button === 1 && !tab.pinned && canCloseAny()) {
                      event.preventDefault();
                      void api.tabClose(tab.id).then(applySession).catch(() => undefined);
                    }
                  }}
                  onClick={() => {
                    cancelHide();
                    void api.tabActivate(tab.id).then(applySession).catch(() => undefined);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelHide();
                    void api.tabOpenContextMenu(tab.id, event.clientX, event.clientY).catch(() => undefined);
                  }}
                >
                  <Show when={isActive()}>
                    <span class="tab-dock__dot" classList={{ "is-isolated": tab.isolated }} aria-hidden="true" />
                  </Show>
                  <span class="tab-item__leading" classList={{ "has-avatar": tab.isolated && Boolean(tab.avatarUrl) }}>
                    <Show
                      when={tab.isolated}
                      fallback={<Icon name="brand" source="youtube" size={16} class="tab-item__yt-brand" />}
                    >
                      <Show
                        when={tab.avatarUrl}
                        fallback={<Icon name="tab-isolated" size={14} class="tab-item__isolated-icon" />}
                      >
                        <img src={tab.avatarUrl!} alt="" referrerpolicy="no-referrer" />
                        <span class="tab-item__isolated-pip" aria-hidden="true" />
                      </Show>
                    </Show>
                  </span>
                  <DockTabTitle title={tab.title} />
                  <Show when={tab.sleeping}>
                    <span class="tab-item__sleep-badge" title={t("tabs.sleeping")} aria-label={t("tabs.sleeping")}>
                      <Icon name="sleep" size={12} />
                    </span>
                  </Show>
                  <Show when={tab.isPlaying || tab.muted}>
                    <button
                      type="button"
                      class="tab-item__mute"
                      classList={{ "is-muted": tab.muted }}
                      title={t(tab.muted ? "tabs.unmute" : "tabs.mute")}
                      aria-label={t(tab.muted ? "tabs.unmute" : "tabs.mute")}
                      onClick={(event) => {
                        event.stopPropagation();
                        void api.tabSetMuted(tab.id, !tab.muted).then(applySession).catch(() => undefined);
                      }}
                    >
                      <Show
                        when={!tab.muted && tab.isPlaying}
                        fallback={<Icon name={tab.muted ? "volume-mute" : "volume"} size={12} />}
                      >
                        <span class="tab-item__equalizer" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      </Show>
                    </button>
                  </Show>
                  <Show when={!tab.pinned && canCloseAny()}>
                    <button
                      type="button"
                      class="tab-item__close"
                      title={t("tabs.closeTab")}
                      aria-label={t("tabs.closeTab")}
                      onClick={(event) => {
                        event.stopPropagation();
                        void api.tabClose(tab.id).then(applySession).catch(() => undefined);
                      }}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </Show>
                </div>
              );
            }}
            </For>
          </div>
        </Show>

        <div class="tab-dock__actions" ref={actionsEl}>
          <button
            type="button"
            class="tab-dock__btn"
            title={t("tabs.newTab")}
            aria-label={t("tabs.newTab")}
            onClick={() => void api.tabCreate({ activate: true }).then(applySession).catch(() => undefined)}
          >
            <Icon name="plus" size={15} />
          </button>
          <button
            type="button"
            class="tab-dock__btn tab-bar__btn--isolated"
            title={t("tabs.newIsolatedTab")}
            aria-label={t("tabs.newIsolatedTab")}
            onClick={() => void api.tabCreate({ isolated: true, activate: true }).then(applySession).catch(() => undefined)}
          >
            <Icon name="tab-isolated" size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function mountTabDock(root: HTMLElement): void {
  render(() => <TabDockView />, root);
}
