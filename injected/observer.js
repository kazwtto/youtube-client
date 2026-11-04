/**
 * YouTube player observer.
 *
 * Injected as an initialization script into the `yt` webview. All DOM
 * selectors live in this file: YouTube changes its structure frequently,
 * so this is the only place that needs maintenance.
 */
(function () {
  "use strict";

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
  let intervalId = null;

  function canInvoke() {
    return Boolean(
      window.__TAURI_INTERNALS__ &&
        typeof window.__TAURI_INTERNALS__.invoke === "function",
    );
  }

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
    accountFetchAttempts += 1;
    if (!window.ytcfg || typeof window.ytcfg.get !== "function") {
      return;
    }
    const apiKey = window.ytcfg.get("INNERTUBE_API_KEY");
    const context = window.ytcfg.get("INNERTUBE_CONTEXT");
    if (!apiKey || !context) {
      return;
    }

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
    fetch("/youtubei/v1/account/account_menu?prettyPrint=false&key=" + apiKey, {
      method: "POST",
      headers,
      body: JSON.stringify({ context }),
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => {
        accountFetchInProgress = false;
        try {
          const popup =
            data &&
            data.actions &&
            data.actions[0] &&
            data.actions[0].openPopupAction &&
            data.actions[0].openPopupAction.popup &&
            data.actions[0].openPopupAction.popup.multiPageMenuRenderer;
          const header = popup && popup.header && popup.header.activeAccountHeaderRenderer;
          if (header) {
            const name =
              (header.accountName && header.accountName.simpleText) ||
              (header.accountName && header.accountName.runs && header.accountName.runs[0] && header.accountName.runs[0].text);
            const handle =
              (header.channelHandle && header.channelHandle.simpleText) ||
              (header.channelHandle && header.channelHandle.runs && header.channelHandle.runs[0] && header.channelHandle.runs[0].text);
            const thumbs = header.avatar && header.avatar.thumbnails;
            const avatar = Array.isArray(thumbs) && thumbs.length > 0 ? thumbs[thumbs.length - 1].url : null;
            if (name) cachedAccountName = name;
            if (handle) cachedAccountHandle = handle;
            if (avatar) cachedAvatarUrl = avatar;
            reportAuth();
          }
        } catch (_) {}
      })
      .catch(() => {
        accountFetchInProgress = false;
      });
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
    if (!canInvoke()) {
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

    const avatarImg = document.querySelector(
      "button#avatar-btn img, #avatar-btn img, ytd-topbar-menu-button-renderer img, yt-avatar-shape img, yt-img-shadow#avatar img, button.yt-spec-button-shape-next--avatar img, ytd-masthead #avatar-btn img",
    );
    const avatarSrc = avatarImg ? (avatarImg.src || avatarImg.currentSrc || avatarImg.getAttribute("src")) : null;

    let resolvedAvatar = cachedAvatarUrl || (initData && initData.avatar) || (avatarSrc && avatarSrc.startsWith("http") ? avatarSrc : null);
    if (resolvedAvatar && resolvedAvatar.startsWith("//")) {
      resolvedAvatar = "https:" + resolvedAvatar;
    }

    let resolvedName = cachedAccountName || (initData && initData.name) || (domParsed && domParsed.name);
    let resolvedHandle = cachedAccountHandle || (initData && initData.handle) || (domParsed && domParsed.handle);

    const loginLink = document.querySelector("#buttons a[href*='ServiceLogin'], ytd-button-renderer a[href*='ServiceLogin']");

    let authState = null;
    if (isYtcfgLoggedIn === true || Boolean(resolvedAvatar) || (isYtcfgLoggedIn !== false && !loginLink && Boolean(resolvedName))) {
      authState = {
        loggedIn: true,
        avatarUrl: resolvedAvatar || null,
        displayName: resolvedName || null,
        handle: resolvedHandle || null,
      };

      if (!cachedAccountName) {
        fetchAccountMenu();
      }
    } else if (isYtcfgLoggedIn === false || loginLink) {
      authState = { loggedIn: false, avatarUrl: null, displayName: null, handle: null };
    }

    if (!authState) {
      return;
    }

    const sig = JSON.stringify(authState);
    if (sig === lastAuthSignature) {
      return;
    }

    lastAuthSignature = sig;
    window.__TAURI_INTERNALS__.invoke("auth_snapshot", { auth: authState }).catch(() => {});
  }

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
      return null;
    }

    const video = player.querySelector("video");
    if (!video) {
      return null;
    }

    const videoId = readVideoId(player);
    if (!videoId) {
      return null;
    }

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
    }, 2000);
    report();
    reportAuth();
  }

  window.addEventListener("yt-navigate-finish", () => {
    lastSignature = "";
    lastAuthSignature = "";
    report();
    reportAuth();
  });

  window.addEventListener("beforeunload", () => {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
    }
    send(EMPTY_SNAPSHOT);
  });

  document.addEventListener("play", report, true);
  document.addEventListener("pause", report, true);
  document.addEventListener("ended", report, true);

  schedule();
})();
