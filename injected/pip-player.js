/**
 * Mini player chrome, inside the player frame.
 *
 * Injected into every frame of the mini player window. Only the YouTube frame
 * acts: the element that draws the YouTube logo over the video is replaced, in
 * the same container, by the window buttons.
 *
 * The frame is cross-origin, so the buttons post a message to the page that
 * hosts the frame, which owns the window.
 */
(function () {
  "use strict";

  if (window.top === window || !/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) {
    return;
  }

  // The wordmark YouTube paints over the video. The first selector is the one
  // the app targets; the others are the names the same element had before.
  const LOGO = [
    ".watch-on-youtube-button-wrapper",
    ".ytp-youtube-button",
    ".ytp-watermark",
  ].join(",");

  const CONTROLS_ID = "ytdesktop-pip-controls";

  const SOURCE = "ytdesktop-pip";

  const CSS =
    "#" +
    CONTROLS_ID +
    "{display:flex;align-items:center;justify-content:flex-end;gap:2px;box-sizing:border-box;padding:0;margin:0}" +
    "#" +
    CONTROLS_ID +
    " button{display:grid;place-items:center;box-sizing:border-box;width:var(--pip-button,28px);height:var(--pip-button,28px);margin:0;padding:0;border:0;border-radius:50%;background:transparent;color:#fff;cursor:pointer;transition:background 140ms ease-out;-webkit-appearance:none}" +
    "#" +
    CONTROLS_ID +
    " button:hover{background:rgba(255,255,255,.18)}" +
    "#" +
    CONTROLS_ID +
    " button:active{background:rgba(255,255,255,.3)}" +
    "#" +
    CONTROLS_ID +
    " .ytdesktop-close:hover{background:#d93025}" +
    "#" +
    CONTROLS_ID +
    " .ytdesktop-g{position:relative;display:block;width:14px;height:14px;color:#fff;pointer-events:none}" +
    "#" +
    CONTROLS_ID +
    " .ytdesktop-g-prev::before{content:\"\";position:absolute;left:0;top:2px;width:2px;height:10px;background:currentColor;border-radius:1px}" +
    "#" +
    CONTROLS_ID +
    " .ytdesktop-g-prev::after{content:\"\";position:absolute;left:4px;top:3px;border-top:4px solid transparent;border-bottom:4px solid transparent;border-right:6px solid currentColor}" +
    "#" +
    CONTROLS_ID +
    " .ytdesktop-g-next::before{content:\"\";position:absolute;right:0;top:2px;width:2px;height:10px;background:currentColor;border-radius:1px}" +
    "#" +
    CONTROLS_ID +
    " .ytdesktop-g-next::after{content:\"\";position:absolute;right:4px;top:3px;border-top:4px solid transparent;border-bottom:4px solid transparent;border-left:6px solid currentColor}" +
    "#" +
    CONTROLS_ID +
    " .ytdesktop-g-close::before,#" +
    CONTROLS_ID +
    " .ytdesktop-g-close::after{content:\"\";position:absolute;left:1px;top:6px;width:12px;height:2px;background:currentColor;border-radius:1px;transform:rotate(45deg)}" +
    "#" +
    CONTROLS_ID +
    " .ytdesktop-g-close::after{transform:rotate(-45deg)}" +
    "#" +
    CONTROLS_ID +
    " .ytdesktop-g-restore{box-sizing:border-box;border:2px solid currentColor;border-radius:2px;width:13px;height:11px}" +
    "#" +
    CONTROLS_ID +
    " .ytdesktop-g-restore::before{content:\"\";position:absolute;left:0;top:2px;width:100%;height:2px;background:currentColor}" +
    /* Smooth overlay transitions and quick autohide */
    "#player-controls, .ytPlayerControlsContainerHost, .ytp-chrome-bottom, .ytp-chrome-top, .ytp-gradient-bottom, .ytp-gradient-top {" +
    "  transition: opacity 160ms ease-out, visibility 160ms ease-out !important;" +
    "}" +
    "body.ytdesktop-autohide #player-controls," +
    "body.ytdesktop-autohide .ytPlayerControlsContainerHost," +
    "body.ytdesktop-autohide .ytp-chrome-bottom," +
    "body.ytdesktop-autohide .ytp-chrome-top," +
    "body.ytdesktop-autohide .ytp-gradient-bottom," +
    "body.ytdesktop-autohide .ytp-gradient-top {" +
    "  opacity: 0 !important;" +
    "  visibility: hidden !important;" +
    "  pointer-events: none !important;" +
    "}";

  function send(action, data) {
    try {
      const payload = Object.assign({ source: SOURCE, action: action }, data || {});
      window.parent.postMessage(payload, "*");
    } catch (_error) {
      // Nothing to do: the window is closing.
    }
  }

  function icon(name) {
    const glyph = document.createElement("span");
    glyph.className = "ytdesktop-g ytdesktop-g-" + name;
    return glyph;
  }

  function createControls() {
    const controls = document.createElement("div");
    controls.id = CONTROLS_ID;

    [
      { action: "prev", title: "Vídeo anterior", icon: "prev", className: "" },
      { action: "next", title: "Próximo vídeo", icon: "next", className: "" },
      { action: "restore", title: "Voltar ao app", icon: "restore", className: "" },
      { action: "close", title: "Fechar", icon: "close", className: "ytdesktop-close" },
    ].forEach(function (item) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = item.title;
      button.setAttribute("aria-label", item.title);
      button.dataset.action = item.action;
      if (item.className) {
        button.className = item.className;
      }

      button.appendChild(icon(item.icon));

      button.addEventListener("click", function (event) {
        event.stopPropagation();
        if (item.action === "restore") {
          const video = document.querySelector("video");
          if (video && Number.isFinite(video.currentTime)) {
            send("sync_time", { time: video.currentTime });
          }
        }
        send(item.action);
      });

      controls.appendChild(button);
    });

    controls.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
    });

    return controls;
  }

  function findLogo() {
    const logos = document.querySelectorAll(LOGO);
    for (let index = 0; index < logos.length; index += 1) {
      const logo = logos[index];
      const rect = logo.getBoundingClientRect();
      if (rect.height > 0 && rect.width > 0) {
        return logo;
      }
    }
    return null;
  }

  function place() {
    const logo = findLogo();
    if (!logo) {
      return;
    }

    const host = logo.parentElement;
    if (!host) {
      return;
    }

    const rect = logo.getBoundingClientRect();

    let controls = document.getElementById(CONTROLS_ID);
    if (!controls) {
      controls = createControls();
    }

    const size = Math.round(Math.min(Math.max(rect.height - 6, 24), 40));

    controls.style.setProperty("--pip-button", size + "px");
    controls.style.width = Math.round(rect.width) + "px";
    controls.style.height = Math.round(rect.height) + "px";

    // Takes the logo's place inside the very container that held it.
    logo.replaceWith(controls);
  }

  // Detects whether an element is an interactive control that should not trigger dragging.
  function isInteractive(target) {
    if (!target || !(target instanceof Element)) {
      return false;
    }

    // Interactive HTML tags
    if (target.closest("button, a, input, textarea, select")) {
      return true;
    }

    // ARIA roles for controls, buttons, sliders, menus
    if (target.closest("[role='button'], [role='slider'], [role='menu'], [role='menuitem'], [role='tab']")) {
      return true;
    }

    // Timeline, scrubber, progress bar and controls
    if (
      target.closest(
        ".ytp-progress-bar, .ytp-progress-bar-container, .ytp-scrubber-container, .ytp-scrubber-button, .ytp-chrome-bottom, [class*='ProgressBar'], [class*='progressBar'], [class*='scrubber'], [class*='Scrubber'], #" +
          CONTROLS_ID
      )
    ) {
      return true;
    }

    return false;
  }

  // Intelligent dragging: initiates native OS dragging after minimal movement.
  function watchDrag() {
    let press = null;
    let dragged = false;

    document.addEventListener(
      "pointerdown",
      function (event) {
        if (event.button !== 0) {
          return;
        }

        const target = event.target instanceof Element ? event.target : null;
        if (isInteractive(target)) {
          return;
        }

        press = {
          x: event.clientX,
          y: event.clientY,
        };
        dragged = false;
      },
      true
    );

    document.addEventListener(
      "pointermove",
      function (event) {
        if (!press) {
          return;
        }

        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 5) {
          press = null;
          dragged = true;
          send("drag");
        }
      },
      true
    );

    function cancelPress() {
      press = null;
      if (dragged) {
        window.setTimeout(function () {
          dragged = false;
        }, 100);
      }
    }

    document.addEventListener("pointerup", cancelPress, true);
    document.addEventListener("pointercancel", cancelPress, true);

    // A press that was dragged must not toggle the video play state.
    document.addEventListener(
      "click",
      function (event) {
        const target = event.target instanceof Element ? event.target : null;
        if (isInteractive(target)) {
          dragged = false;
          return;
        }

        if (dragged) {
          dragged = false;
          event.stopPropagation();
          event.preventDefault();
        }
      },
      true
    );
  }

  // Continuously syncs the playback position to the host so restoring never loses progress.
  function watchTimeSync() {
    let hooked = null;

    function hook() {
      const video = document.querySelector("video");
      if (!video || video === hooked) {
        return;
      }
      hooked = video;

      function sync() {
        if (Number.isFinite(video.currentTime)) {
          send("sync_time", { time: video.currentTime });
        }
      }

      video.addEventListener("timeupdate", sync);
      video.addEventListener("seeking", sync);
      video.addEventListener("pause", sync);
      video.addEventListener("play", sync);
    }

    hook();
    window.setInterval(hook, 1000);
  }

  // Reports the video's native aspect ratio (width / height) to adjust the PiP window.
  let lastReportedRatio = 0;

  function reportRatio() {
    const video = document.querySelector("video");
    if (!video) {
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      return;
    }

    const ratio = width / height;
    if (ratio < 0.4 || ratio > 3.5) {
      return;
    }

    if (Math.abs(ratio - lastReportedRatio) < 0.01) {
      return;
    }

    lastReportedRatio = ratio;
    try {
      window.parent.postMessage({ source: SOURCE, action: "ratio", value: ratio }, "*");
    } catch (_error) {
      // Frame closing.
    }
  }

  // Quick autohide and fade for the YouTube overlay.
  let autohideTimer = null;

  function resetAutohide(delay) {
    if (autohideTimer !== null) {
      window.clearTimeout(autohideTimer);
      autohideTimer = null;
    }

    if (document.body) {
      document.body.classList.remove("ytdesktop-autohide");
    }

    const video = document.querySelector("video");
    if (video && !video.paused && !video.ended) {
      autohideTimer = window.setTimeout(function () {
        if (document.body) {
          document.body.classList.add("ytdesktop-autohide");
        }
      }, delay);
    }
  }

  function setupAutohide() {
    // Movement over entire document resets autohide to 1.2 seconds
    document.addEventListener(
      "pointermove",
      function () {
        resetAutohide(1200);
      },
      true
    );

    // Leaving window triggers quick fade out after 200 milliseconds
    document.addEventListener(
      "pointerleave",
      function () {
        resetAutohide(200);
      },
      true
    );

    window.addEventListener("blur", function () {
      resetAutohide(200);
    });

    document.addEventListener(
      "pause",
      function () {
        if (autohideTimer !== null) {
          window.clearTimeout(autohideTimer);
          autohideTimer = null;
        }
        if (document.body) {
          document.body.classList.remove("ytdesktop-autohide");
        }
      },
      true
    );

    document.addEventListener(
      "play",
      function () {
        resetAutohide(1200);
      },
      true
    );
  }

  function start() {
    const style = document.createElement("style");
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);

    watchDrag();
    setupAutohide();
    watchTimeSync();

    let pending = 0;
    const schedule = function () {
      if (pending) {
        return;
      }
      pending = window.setTimeout(function () {
        pending = 0;
        place();
        reportRatio();
      }, 80);
    };

    place();
    reportRatio();
    schedule();

    // Check periodically for DOM changes and aspect ratio updates
    window.setInterval(function () {
      place();
      reportRatio();
    }, 500);

    const video = document.querySelector("video");
    if (video) {
      video.addEventListener("loadedmetadata", reportRatio);
      video.addEventListener("resize", reportRatio);
      video.addEventListener("play", reportRatio);
    }

    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    window.addEventListener("resize", schedule);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
