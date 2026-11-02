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

  function reportAuth() {
    if (!canInvoke()) {
      return;
    }

    const avatarImg = document.querySelector(
      "#avatar-btn img, ytd-topbar-menu-button-renderer #avatar img, button#avatar-btn img, ytd-masthead #avatar-btn img",
    );
    const loginLink = document.querySelector("#buttons a[href*='ServiceLogin']");

    let authState = null;
    if (avatarImg && avatarImg.src) {
      const nameEl = document.querySelector(
        "#channel-name, #account-name, ytd-multi-page-menu-renderer #account-name",
      );
      const handleEl = document.querySelector(
        "#channel-handle, ytd-multi-page-menu-renderer #channel-handle",
      );
      authState = {
        loggedIn: true,
        avatarUrl: avatarImg.src,
        displayName: nameEl ? (nameEl.textContent || "").trim() : null,
        handle: handleEl ? (handleEl.textContent || "").trim() : null,
      };
    } else if (loginLink) {
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
