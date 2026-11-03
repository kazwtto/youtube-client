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

  function fetchAccountMenu() {
    if (cachedAccountName || accountFetchInProgress) {
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

    accountFetchInProgress = true;
    fetch("/youtubei/v1/account/account_menu?key=" + apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context }),
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => {
        accountFetchInProgress = false;
        try {
          const popup =
            data && data.actions && data.actions[0] && data.actions[0].openPopupAction && data.actions[0].openPopupAction.popup && data.actions[0].openPopupAction.popup.multiPageMenuRenderer;
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
            if (name) {
              cachedAccountName = name;
            }
            if (handle) {
              cachedAccountHandle = handle;
            }
            if (avatar) {
              cachedAvatarUrl = avatar;
            }
            reportAuth();
          }
        } catch (_) {}
      })
      .catch(() => {
        accountFetchInProgress = false;
      });
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
      if (label) {
        const m = label.match(/(?:Conta do Google|Google Account|Conta da Google)[^:]*:\s*([^(\n]+)/i);
        if (m && m[1] && m[1].trim() && m[1].trim().toLowerCase() !== "youtube") {
          return m[1].trim();
        }
        const m2 = label.match(/(?:Foto do perfil de|Avatar de|Profile photo of)\s*([^(\n]+)/i);
        if (m2 && m2[1] && m2[1].trim() && m2[1].trim().toLowerCase() !== "youtube") {
          return m2[1].trim();
        }
      }
      const img = el.querySelector("img");
      if (img) {
        const alt = img.getAttribute("alt") || "";
        const mAlt = alt.match(/(?:Foto do perfil de|Profile photo of|Avatar of)\s*([^(\n]+)/i);
        if (mAlt && mAlt[1] && mAlt[1].trim() && mAlt[1].trim().toLowerCase() !== "youtube") {
          return mAlt[1].trim();
        }
        if (alt && !alt.toLowerCase().includes("avatar") && !alt.toLowerCase().includes("foto") && alt.toLowerCase() !== "youtube") {
          return alt.trim();
        }
      }
    }

    const guideLink = document.querySelector("ytd-guide-entry-renderer a[href*='/@']");
    if (guideLink) {
      const text = (guideLink.textContent || "").trim();
      if (text && text.toLowerCase() !== "youtube" && text.toLowerCase() !== "seu canal" && text.toLowerCase() !== "your channel") {
        return text;
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

    function extractFromInitialData() {
      try {
        const data = window.ytInitialData;
        const buttons = data && data.topbar && data.topbar.desktopTopbarRenderer && data.topbar.desktopTopbarRenderer.topbarButtons;
        if (Array.isArray(buttons)) {
          for (const btn of buttons) {
            const menuBtn = btn.topbarMenuButtonRenderer;
            if (!menuBtn) continue;
            const thumbs = menuBtn.avatar && menuBtn.avatar.thumbnails;
            const avatar = Array.isArray(thumbs) && thumbs.length > 0 ? thumbs[thumbs.length - 1].url : null;
            let name = null;
            let h = null;
            const header = menuBtn.menuRenderer && menuBtn.menuRenderer.multiPageMenuRenderer && menuBtn.menuRenderer.multiPageMenuRenderer.header && menuBtn.menuRenderer.multiPageMenuRenderer.header.activeAccountHeaderRenderer;
            if (header) {
              name = (header.accountName && header.accountName.simpleText) || (header.accountName && header.accountName.runs && header.accountName.runs[0] && header.accountName.runs[0].text) || null;
              h = (header.channelHandle && header.channelHandle.simpleText) || (header.channelHandle && header.channelHandle.runs && header.channelHandle.runs[0] && header.channelHandle.runs[0].text) || null;
            }
            if (avatar || name || h) {
              return { avatar, name, handle: h };
            }
          }
        }
      } catch (_) {}
      return null;
    }

    function extractFromYtcfg() {
      try {
        if (window.ytcfg && typeof window.ytcfg.get === "function") {
          const user = window.ytcfg.get("INNERTUBE_CONTEXT") && window.ytcfg.get("INNERTUBE_CONTEXT").user;
          const avatar = window.ytcfg.get("USER_AVATAR") || (window.ytcfg.data_ && window.ytcfg.data_.USER_AVATAR) || null;
          return {
            avatar: avatar,
            name: (user && user.onBehalfOfUser) || null,
          };
        }
      } catch (_) {}
      return null;
    }

    let domAvatar = null;
    const avatarImg = document.querySelector(
      "button#avatar-btn img, #avatar-btn img, ytd-topbar-menu-button-renderer img, yt-avatar-shape img, yt-img-shadow#avatar img, button.yt-spec-button-shape-next--avatar img, ytd-masthead #avatar-btn img, #masthead #avatar-btn img",
    );
    if (avatarImg) {
      const src = avatarImg.src || avatarImg.currentSrc || avatarImg.getAttribute("src");
      if (src && !src.startsWith("data:") && src !== "about:blank") {
        domAvatar = src;
      }
    }

    const initData = extractFromInitialData();
    const cfgData = extractFromYtcfg();

    let resolvedAvatar = cachedAvatarUrl || (initData && initData.avatar) || (cfgData && cfgData.avatar) || domAvatar || null;
    if (resolvedAvatar && resolvedAvatar.startsWith("//")) {
      resolvedAvatar = "https:" + resolvedAvatar;
    }

    let resolvedName = cachedAccountName || (initData && initData.name) || (cfgData && cfgData.name) || extractNameFromDOM();
    if (!resolvedName) {
      const nameEl = document.querySelector(
        "#channel-name, #account-name, ytd-multi-page-menu-renderer #account-name, ytd-active-account-header-renderer #account-name",
      );
      if (nameEl) {
        const text = (nameEl.textContent || "").trim();
        if (text && text.toLowerCase() !== "youtube") {
          resolvedName = text;
        }
      }
    }

    let resolvedHandle = cachedAccountHandle || (initData && initData.handle);
    if (!resolvedHandle) {
      const handleEl = document.querySelector(
        "#channel-handle, ytd-multi-page-menu-renderer #channel-handle, ytd-active-account-header-renderer #channel-handle",
      );
      if (handleEl) {
        const text = (handleEl.textContent || "").trim();
        if (text) {
          resolvedHandle = text;
        }
      }
    }

    const loginLink = document.querySelector(
      "#buttons a[href*='ServiceLogin'], ytd-button-renderer a[href*='ServiceLogin']",
    );

    let authState = null;
    if (isYtcfgLoggedIn === true || Boolean(resolvedAvatar) || (isYtcfgLoggedIn !== false && !loginLink && Boolean(resolvedName))) {
      authState = {
        loggedIn: true,
        avatarUrl: resolvedAvatar || null,
        displayName: resolvedName || null,
        handle: resolvedHandle || null,
      };

      if (!resolvedName) {
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
