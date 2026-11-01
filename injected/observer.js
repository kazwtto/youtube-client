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
    title: "div.ytp-chrome-top a.ytp-title-link",
    channel: "#upload-info #channel-name a",
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
  let intervalId = null;

  function canInvoke() {
    return Boolean(
      window.__TAURI_INTERNALS__ &&
        typeof window.__TAURI_INTERNALS__.invoke === "function",
    );
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
      if (url.hostname.endsWith("youtube.com") && url.pathname === "/watch") {
        return url.searchParams.get("v");
      }
    } catch (_error) {
      // Ignore invalid URLs.
    }

    return null;
  }

  function readText(selector) {
    const element = document.querySelector(selector);
    if (!element) {
      return null;
    }

    const text = (element.textContent || "").trim();
    return text || null;
  }

  /// Resolves the absolute channel URL from the channel link.
  function readChannelUrl() {
    const element = document.querySelector(SELECTORS.channel);
    if (!element) {
      return null;
    }

    const href = element.getAttribute("href") || element.href;
    if (!href) {
      return null;
    }

    try {
      return new URL(href, window.location.origin).href;
    } catch (_error) {
      return null;
    }
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
      title: readText(SELECTORS.title) || document.title.replace(/\s*-\s*YouTube$/, ""),
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

    intervalId = window.setInterval(report, 2000);
    report();
  }

  window.addEventListener("yt-navigate-finish", () => {
    lastSignature = "";
    report();
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