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
    " button{display:grid;place-items:center;box-sizing:border-box;width:var(--pip-button,28px);height:var(--pip-button,28px);margin:0;padding:0;border:0;border-radius:50%;background:transparent;color:#fff;cursor:pointer;transition:background 120ms ease;-webkit-appearance:none}" +
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
    " .ytdesktop-g-restore::before{content:\"\";position:absolute;left:0;top:2px;width:100%;height:2px;background:currentColor}";

  function send(action) {
    try {
      window.parent.postMessage({ source: SOURCE, action: action }, "*");
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

  // A press that turns into a movement moves the window. A press without
  // movement stays a click, so the player keeps working.
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
        if (!target) {
          return;
        }

        if (target.closest("button, a, input, textarea, select, #" + CONTROLS_ID)) {
          return;
        }

        const player = document.querySelector(".html5-video-player");
        if (!player || !player.contains(target)) {
          return;
        }

        press = { x: event.clientX, y: event.clientY };
        dragged = false;
      },
      true,
    );

    document.addEventListener(
      "pointermove",
      function (event) {
        if (!press) {
          return;
        }

        if (Math.abs(event.clientX - press.x) < 4 && Math.abs(event.clientY - press.y) < 4) {
          return;
        }

        press = null;
        dragged = true;
        send("drag");
      },
      true,
    );

    document.addEventListener(
      "pointerup",
      function () {
        press = null;
      },
      true,
    );

    // The press that started a drag must not also toggle the video.
    document.addEventListener(
      "click",
      function (event) {
        if (dragged) {
          dragged = false;
          event.stopPropagation();
          event.preventDefault();
        }
      },
      true,
    );
  }

  function start() {
    const style = document.createElement("style");
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);

    watchDrag();

    let pending = 0;
    const schedule = function () {
      if (pending) {
        return;
      }
      pending = window.setTimeout(function () {
        pending = 0;
        place();
      }, 80);
    };

    place();
    schedule();

    // The player builds its chrome after the document is ready and rebuilds it
    // whenever the page changes, so the slot is re-checked until it shows up and
    // kept in place afterwards.
    window.setInterval(place, 500);

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
