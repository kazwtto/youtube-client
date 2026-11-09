/**
 * YouTube player observer.
 *
 * Injected as an initialization script into the `yt` webview. All DOM
 * selectors live in this file: YouTube changes its structure frequently,
 * so this is the only place that needs maintenance.
 */
(function () {
  "use strict";

  if (window !== window.top) return;

  const SELECTORS = {
    player: "#movie_player",
    videoTitle: [
      "h1.ytd-watch-metadata yt-formatted-string",
      "h1.title.ytd-video-primary-info-renderer",
      "div.ytp-chrome-top a.ytp-title-link",
    ],
    channel: [
      "#owner #channel-name a",
      "#upload-info #channel-name a",
      "ytd-channel-name a",
      "#owner-name a",
    ],
  };

  const EMPTY_SNAPSHOT = {
    videoId: null,
    title: null,
    channel: null,
    channelUrl: null,
    artworkUrl: null,
    url: null,
    isPlaying: false,
    isLivestream: false,
    positionSecs: null,
    durationSecs: null,
  };

  let lastSignature = "";
  let lastAuthSignature = "";
  let pendingAuthSignature = "";
  let lastTitlebarIconsSignature = "";
  let resumeLookupVideoId = null;
  let intervalId = null;
  let documentUnloading = false;

  function canInvoke() {
    return Boolean(
      window.__TAURI_INTERNALS__ &&
        typeof window.__TAURI_INTERNALS__.invoke === "function",
    );
  }

  let surfacePaintReported = false;
  let surfacePaintScheduled = false;

  function isYoutubeHost() {
    const host = window.location.hostname;
    return host === "youtube.com" || host.endsWith(".youtube.com");
  }

  function scheduleSurfacePaintReport() {
    if (surfacePaintReported || surfacePaintScheduled) return;
    if (!isYoutubeHost()) return;
    surfacePaintScheduled = true;

    // Two animation frames give WebView2 a complete render opportunity after
    // it becomes visible; PageLoad Finished alone can precede its first frame.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        surfacePaintScheduled = false;
        if (surfacePaintReported || !isYoutubeHost()) return;
        if (!canInvoke()) {
          window.setTimeout(scheduleSurfacePaintReport, 100);
          return;
        }

        surfacePaintReported = true;
        window.__TAURI_INTERNALS__
          .invoke("youtube_surface_painted")
          .then((completed) => {
            if (completed) return;
            surfacePaintReported = false;
            window.setTimeout(scheduleSurfacePaintReport, 100);
          })
          .catch(() => {
            surfacePaintReported = false;
            window.setTimeout(scheduleSurfacePaintReport, 100);
          });
      });
    });
  }

  window.__ytdesktopReportSurfacePainted = scheduleSurfacePaintReport;
  document.addEventListener("visibilitychange", () => {
    if (!surfacePaintReported && document.visibilityState === "visible") {
      surfacePaintScheduled = false;
      scheduleSurfacePaintReport();
    }
  });

  let cachedAccountName = null;
  let cachedAccountHandle = null;
  let cachedAvatarUrl = null;
  let accountFetchInProgress = false;

  function parseAccountString(str) {
    if (!str || typeof str !== "string") return null;
    str = str.trim();
    const emailMatch = str.match(/(?:^|[:,\n\s])\s*([^\n,:()]+?)\s*(?:\n|\s)*\(([^)]+@[^)]+)\)/);
    if (emailMatch) {
      const name = emailMatch[1].trim();
      const email = emailMatch[2].trim();
      if (name && name.toLowerCase() !== "youtube") {
        return { name, handle: email };
      }
    }
    const hasPrefix = /^(?:Conta do Google|Google Account|Conta da Google|Foto do perfil|Profile photo)[^:]*:\s*/i.test(str);
    if (!hasPrefix) {
      return null;
    }
    const clean = str.replace(/^(?:Conta do Google|Google Account|Conta da Google|Foto do perfil|Profile photo)[^:]*:\s*/i, "").trim();
    if (clean && clean.toLowerCase() !== "youtube" && !clean.toLowerCase().includes("avatar")) {
      return { name: clean, handle: null };
    }
    return null;
  }

  let accountFetchAttempts = 0;

  async function buildAuthHeader() {
    try {
      const match = document.cookie.match(/(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/);
      if (!match) return null;
      const ts = Math.floor(Date.now() / 1000);
      const origin = window.location.origin;
      const data = new TextEncoder().encode(ts + " " + match[1] + " " + origin);
      const digest = await crypto.subtle.digest("SHA-1", data);
      const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      return "SAPISIDHASH " + ts + "_" + hex;
    } catch (_) {
      return null;
    }
  }

  async function fetchAccountMenu() {
    if (cachedAccountName || accountFetchInProgress || accountFetchAttempts >= 8) {
      return;
    }
    if (!window.ytcfg || typeof window.ytcfg.get !== "function") {
      return;
    }
    const apiKey = window.ytcfg.get("INNERTUBE_API_KEY");
    const context = window.ytcfg.get("INNERTUBE_CONTEXT");
    if (!apiKey || !context) {
      return;
    }

    accountFetchAttempts += 1;
    accountFetchInProgress = true;
    const headers = {
      "Content-Type": "application/json",
      "X-Origin": window.location.origin,
      "X-Goog-AuthUser": String(window.ytcfg.get("SESSION_INDEX") || 0),
    };
    const authHeader = await buildAuthHeader();
    if (authHeader) {
      headers.Authorization = authHeader;
    }
    const pageId = window.ytcfg.get("DELEGATED_SESSION_ID");
    if (pageId) {
      headers["X-Goog-PageId"] = pageId;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch("/youtubei/v1/account/account_menu?prettyPrint=false&key=" + apiKey, {
        method: "POST",
        headers,
        body: JSON.stringify({ context }),
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const data = await response.json();
      try {
        const popup = data?.actions?.[0]?.openPopupAction?.popup?.multiPageMenuRenderer;
        const header = popup?.header?.activeAccountHeaderRenderer;
        if (header) {
          const name = header.accountName?.simpleText || header.accountName?.runs?.[0]?.text;
          const handle = header.channelHandle?.simpleText || header.channelHandle?.runs?.[0]?.text;
          const thumbs = header.avatar?.thumbnails;
          const avatar = Array.isArray(thumbs) && thumbs.length > 0 ? thumbs[thumbs.length - 1].url : null;
          if (name) cachedAccountName = name;
          if (handle) cachedAccountHandle = handle;
          if (avatar) cachedAvatarUrl = avatar;
          reportAuth();
        }
      } catch (_) {}
    } catch (_) {
      // Account details are optional; the login state is reported from the page.
    } finally {
      window.clearTimeout(timeout);
      accountFetchInProgress = false;
    }
  }

  function extractFromInitialData() {
    try {
      const data = window.ytInitialData;
      const buttons =
        data &&
        data.topbar &&
        data.topbar.desktopTopbarRenderer &&
        data.topbar.desktopTopbarRenderer.topbarButtons;
      if (Array.isArray(buttons)) {
        for (const btn of buttons) {
          const menuBtn = btn.topbarMenuButtonRenderer;
          if (!menuBtn) continue;

          let avatar = null;
          const thumbs = menuBtn.avatar && menuBtn.avatar.thumbnails;
          if (Array.isArray(thumbs) && thumbs.length > 0) {
            avatar = thumbs[thumbs.length - 1].url;
          }

          let parsed = null;
          if (menuBtn.tooltip) {
            parsed = parseAccountString(menuBtn.tooltip);
          }
          if (!parsed && menuBtn.accessibility && menuBtn.accessibility.accessibilityData) {
            parsed = parseAccountString(menuBtn.accessibility.accessibilityData.label);
          }

          if (avatar || parsed) {
            return {
              avatar,
              name: parsed ? parsed.name : null,
              handle: parsed ? parsed.handle : null,
            };
          }
        }
      }
    } catch (_) {}
    return null;
  }

  function extractNameFromDOM() {
    const selectors = [
      "button#avatar-btn",
      "#avatar-btn",
      "ytd-topbar-menu-button-renderer button",
      "button.yt-spec-button-shape-next--avatar",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const label = el.getAttribute("aria-label") || el.getAttribute("title") || "";
      const parsed = parseAccountString(label);
      if (parsed && parsed.name) {
        return parsed;
      }
      const img = el.querySelector("img");
      if (img) {
        const alt = img.getAttribute("alt") || "";
        const parsedAlt = parseAccountString(alt);
        if (parsedAlt && parsedAlt.name) {
          return parsedAlt;
        }
      }
    }
    return null;
  }

  function reportAuth() {
    if (!canInvoke() || window !== window.top) {
      return;
    }

    let isYtcfgLoggedIn = null;
    try {
      if (window.ytcfg && typeof window.ytcfg.get === "function") {
        const val = window.ytcfg.get("LOGGED_IN");
        if (typeof val === "boolean") {
          isYtcfgLoggedIn = val;
        }
      }
    } catch (_) {}

    const initData = extractFromInitialData();
    const domParsed = extractNameFromDOM();

    // Only the account control identifies the signed-in user. Channel avatars
    // elsewhere on the page are not evidence of an authenticated session.
    const accountButton = document.querySelector("button#avatar-btn, #avatar-btn, button.yt-spec-button-shape-next--avatar");
    const avatarImg = accountButton ? accountButton.querySelector("img") : null;
    const avatarSrc = avatarImg ? (avatarImg.src || avatarImg.currentSrc || avatarImg.getAttribute("src")) : null;

    let resolvedAvatar = cachedAvatarUrl || (initData && initData.avatar) || (avatarSrc && avatarSrc.startsWith("http") ? avatarSrc : null);
    if (resolvedAvatar && resolvedAvatar.startsWith("//")) {
      resolvedAvatar = "https:" + resolvedAvatar;
    }

    let resolvedName = cachedAccountName || (initData && initData.name) || (domParsed && domParsed.name);
    let resolvedHandle = cachedAccountHandle || (initData && initData.handle) || (domParsed && domParsed.handle);

    const loginLink = document.querySelector("#buttons a[href*='ServiceLogin'], ytd-button-renderer a[href*='ServiceLogin']");

    let authState = null;
    if (isYtcfgLoggedIn === false || (isYtcfgLoggedIn !== true && loginLink)) {
      cachedAccountName = cachedAccountHandle = cachedAvatarUrl = null;
      authState = { loggedIn: false, avatarUrl: null, displayName: null, handle: null };
    } else if (isYtcfgLoggedIn === true || accountButton || Boolean(initData && initData.avatar)) {
      authState = {
        loggedIn: true,
        avatarUrl: resolvedAvatar || null,
        displayName: resolvedName || null,
        handle: resolvedHandle || null,
      };

      if (!cachedAccountName) {
        fetchAccountMenu();
      }
    }

    if (!authState) {
      return;
    }

    const sig = JSON.stringify(authState);
    if (sig === lastAuthSignature || sig === pendingAuthSignature) {
      return;
    }

    pendingAuthSignature = sig;
    window.__TAURI_INTERNALS__.invoke("auth_snapshot", { auth: authState })
      .then(() => { lastAuthSignature = sig; })
      .catch(() => { /* Retry on the next poll if IPC was not ready. */ })
      .finally(() => { if (pendingAuthSignature === sig) pendingAuthSignature = ""; });
  }

  function findIconElement(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function readIconSvg(selectors) {
    const element = findIconElement(selectors);
    if (!element) return null;
    const roots = [element];
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      if (root instanceof SVGSVGElement) return root.outerHTML;
      const svg = root.querySelector("svg");
      if (svg) return svg.outerHTML;
      root.querySelectorAll("*").forEach((child) => {
        if (child.shadowRoot) roots.push(child.shadowRoot);
      });
      if (root.shadowRoot) roots.push(root.shadowRoot);
    }
    return null;
  }

  function reportTitlebarIcons() {
    if (!canInvoke() || window !== window.top) return;
    const candidates = {
      search: readIconSvg(["#search-icon-legacy", "#search-icon"]),
      voice: readIconSvg(["#voice-search-button"]),
      clear: readIconSvg(["#search-clear-button"]),
      guide: readIconSvg(["#guide-button", "#guide-icon"]),
      account: readIconSvg(["#avatar-btn"]),
      history: readIconSvg(["ytd-search-history-query-renderer"]),
    };
    const icons = Object.fromEntries(Object.entries(candidates).filter(([, svg]) => Boolean(svg)));
    if (Object.keys(icons).length === 0) return;
    const signature = JSON.stringify(icons);
    if (signature === lastTitlebarIconsSignature) return;
    lastTitlebarIconsSignature = signature;
    window.__TAURI_INTERNALS__.invoke("youtube_titlebar_icons_snapshot", { icons }).catch(() => {});
  }

  window.__ytdesktopRequestAuthSnapshot = () => {
    lastAuthSignature = "";
    reportAuth();
  };
  window.__ytdesktopActivateVoiceSearch = () => {
    if (window !== window.top) return false;
    const roots = [document];
    let hostFallback = null;
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      const button = root.querySelector("#voice-search-button button, #voice-search-button [role=button], button#voice-search-button");
      if (button instanceof HTMLElement) { button.click(); return true; }
      const host = root.querySelector("#voice-search-button");
      if (host instanceof HTMLElement) {
        hostFallback ||= host;
        if (host.shadowRoot) roots.push(host.shadowRoot);
      }
      root.querySelectorAll("*").forEach((element) => {
        if (element.shadowRoot) roots.push(element.shadowRoot);
      });
    }
    if (hostFallback) { hostFallback.click(); return true; }
    return false;
  };
  window.__ytdesktopReportTitlebarIcons = reportTitlebarIcons;

  function send(snapshot) {
    if (!canInvoke()) {
      return;
    }

    window.__TAURI_INTERNALS__.invoke("player_snapshot", { snapshot }).catch(() => {
      // The webview may be navigating; the next read will try again.
    });
  }

  function readVideoId(player) {
    try {
      if (typeof player.getVideoData === "function") {
        const data = player.getVideoData();
        if (data && data.video_id) {
          return data.video_id;
        }
      }
    } catch (_error) {
      // Ignore failures from the internal player.
    }

    try {
      const url = new URL(window.location.href);
      if (url.hostname.endsWith("youtube.com")) {
        if (url.pathname === "/watch") {
          return url.searchParams.get("v");
        }
        if (url.pathname.startsWith("/shorts/")) {
          const parts = url.pathname.split("/");
          return parts[2] || null;
        }
      }
    } catch (_error) {
      // Ignore invalid URLs.
    }

    return null;
  }

  function readText(selector) {
    if (Array.isArray(selector)) {
      for (const sel of selector) {
        const text = readText(sel);
        if (text) {
          return text;
        }
      }
      return null;
    }

    const element = document.querySelector(selector);
    if (!element) {
      return null;
    }

    const text = (element.textContent || "").trim();
    return text || null;
  }

  /// Resolves the absolute channel URL from the channel link.
  function readChannelUrl() {
    const selectors = Array.isArray(SELECTORS.channel)
      ? SELECTORS.channel
      : [SELECTORS.channel];

    for (const sel of selectors) {
      const element = document.querySelector(sel);
      if (element) {
        const href = element.getAttribute("href") || element.href;
        if (href) {
          try {
            return new URL(href, window.location.origin).href;
          } catch (_error) {
            // Try next selector
          }
        }
      }
    }

    return null;
  }

  function currentSnapshot() {
    const player = document.getElementById("movie_player");
    if (!player) {
      resumeLookupVideoId = null;
      return null;
    }

    const video = player.querySelector("video");
    if (!video) {
      resumeLookupVideoId = null;
      return null;
    }

    const videoId = readVideoId(player);
    if (!videoId) {
      resumeLookupVideoId = null;
      return null;
    }

    resumeFromHistory(player, video, videoId);

    const duration = Number.isFinite(video.duration) ? video.duration : null;
    const position = Number.isFinite(video.currentTime) ? video.currentTime : null;
    const isLivestream =
      video.duration === Infinity || player.classList.contains("ytp-live");

    return {
      videoId,
      title:
        readText(SELECTORS.videoTitle) ||
        document.title.replace(/\s*-\s*YouTube$/, "").trim() ||
        readText("div.ytp-chrome-top a.ytp-title-link"),
      channel: readText(SELECTORS.channel),
      channelUrl: readChannelUrl(),
      artworkUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: `${window.location.origin}/watch?v=${videoId}`,
      isPlaying: !video.paused && !video.ended,
      isLivestream,
      positionSecs: position,
      durationSecs: isLivestream ? null : duration,
    };
  }

  function resumeFromHistory(player, video, videoId) {
    if (window !== window.top || resumeLookupVideoId === videoId || !canInvoke()) return;
    resumeLookupVideoId = videoId;

    window.__TAURI_INTERNALS__
      .invoke("history_resume_position", { videoId })
      .then((position) => {
        if (!Number.isFinite(position) || position < 2) return;

        const seekToSavedPosition = () => {
          const activeVideo = player.querySelector("video");
          if (
            readVideoId(player) !== videoId ||
            !activeVideo ||
            activeVideo.duration === Infinity
          ) {
            return;
          }

          if (activeVideo.readyState < 1) {
            activeVideo.addEventListener("loadedmetadata", seekToSavedPosition, { once: true });
            return;
          }

          if (activeVideo.currentTime > 5) return;

          if (Number.isFinite(activeVideo.duration) && position >= activeVideo.duration - 5) {
            return;
          }

          try {
            activeVideo.currentTime = position;
          } catch (_) {
            // Some live or not-yet-seekable media cannot accept a seek yet.
          }
        };

        if (video.readyState >= 1) seekToSavedPosition();
        else video.addEventListener("loadedmetadata", seekToSavedPosition, { once: true });
      })
      .catch(() => {
        // Resume is optional; keep playback working if the local history is unavailable.
      });
  }

  function report() {
    const snapshot = currentSnapshot();
    const payload = snapshot || EMPTY_SNAPSHOT;
    const signature = JSON.stringify(payload);

    if (signature === lastSignature) {
      return;
    }

    lastSignature = signature;
    send(payload);
  }

  function schedule() {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
    }

    intervalId = window.setInterval(() => {
      report();
      reportAuth();
      reportTitlebarIcons();
    }, 2000);
    report();
    reportAuth();
    reportTitlebarIcons();
  }

  window.addEventListener("yt-navigate-finish", () => {
    lastSignature = "";
    lastAuthSignature = "";
    resumeLookupVideoId = null;
    report();
    reportAuth();
    lastTitlebarIconsSignature = "";
    reportTitlebarIcons();
  });

  window.addEventListener("beforeunload", () => {
    documentUnloading = true;
    if (intervalId !== null) {
      window.clearInterval(intervalId);
    }
    if (window === window.top && document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    }
    if (window === window.top && canInvoke()) {
      window.__TAURI_INTERNALS__.invoke("set_native_pip_active", { active: false }).catch(() => {});
    }
    send(EMPTY_SNAPSHOT);
  });

  document.addEventListener("enterpictureinpicture", () => {
    if (window !== window.top || !canInvoke()) return;
    window.__TAURI_INTERNALS__.invoke("set_native_pip_active", { active: true }).catch(() => {});
  }, true);
  document.addEventListener("leavepictureinpicture", () => {
    if (window !== window.top || !canInvoke()) return;
    if (documentUnloading) {
      window.__TAURI_INTERNALS__.invoke("set_native_pip_active", { active: false }).catch(() => {});
      return;
    }
    window.__TAURI_INTERNALS__.invoke("native_pip_return").catch(() => {});
  }, true);

  document.addEventListener("play", report, true);
  document.addEventListener("pause", report, true);
  document.addEventListener("ended", report, true);

  schedule();
})();
