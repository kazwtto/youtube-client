/**
 * YouTube theme bridge.
 *
 * Injected as an initialization script into the `yt` webview. It receives the
 * resolved application theme from the backend and maps the palette onto
 * YouTube's design tokens, so the theme is visible on the site as well as in
 * the launcher interface.
 *
 * The theme is fetched on every document load (initialization scripts run
 * again after a navigation or reload), and the backend can push an update at
 * any time through `window.__ytdesktopApplyTheme`.
 */
(function () {
  "use strict";

  const STYLE_ID = "ytdesktop-theme";

  function tokenValue(theme, name, fallback) {
    const tokens = theme && theme.tokens ? theme.tokens : {};
    const value = tokens[name];
    return typeof value === "string" && value ? value : fallback;
  }

  function buildCss(theme) {
    const dark = Boolean(theme) && theme.effectiveMode === "dark";
    const bg = tokenValue(theme, "--color-bg-solid", dark ? "#0f0f0f" : "#ffffff");
    const elevated = tokenValue(theme, "--color-bg-elevated", dark ? "#212121" : "#f9f9f9");
    const fg = tokenValue(theme, "--color-fg", dark ? "#f1f1f1" : "#0f0f0f");
    const muted = tokenValue(theme, "--color-fg-muted", dark ? "#aaaaaa" : "#606060");
    const border = tokenValue(
      theme,
      "--color-border",
      dark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.1)",
    );
    const hover = tokenValue(
      theme,
      "--color-hover",
      dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)",
    );
    const accent = (theme && theme.accent) || tokenValue(theme, "--color-accent", "#0a84ff");
    const accentFg = tokenValue(theme, "--color-accent-fg", "#ffffff");

    return [
      "html, html[dark] {",
      `  color-scheme: ${dark ? "dark" : "light"};`,
      `  --yt-spec-base-background: ${bg};`,
      `  --yt-spec-raised-background: ${bg};`,
      `  --yt-spec-menu-background: ${elevated};`,
      `  --yt-spec-general-background-a: ${bg};`,
      `  --yt-spec-general-background-b: ${bg};`,
      `  --yt-spec-general-background-c: ${bg};`,
      `  --yt-spec-brand-background-solid: ${bg};`,
      `  --yt-spec-brand-background-primary: ${bg};`,
      `  --yt-spec-brand-background-secondary: ${bg};`,
      `  --yt-spec-text-primary: ${fg};`,
      `  --yt-spec-text-primary-inverse: ${bg};`,
      `  --yt-spec-text-secondary: ${muted};`,
      `  --yt-spec-text-disabled: ${muted};`,
      `  --yt-spec-icon-active-other: ${fg};`,
      `  --yt-spec-icon-inactive: ${muted};`,
      `  --yt-spec-icon-disabled: ${muted};`,
      `  --yt-spec-call-to-action: ${accent};`,
      `  --yt-spec-suggested-action: ${accent};`,
      `  --yt-spec-themed-blue: ${accent};`,
      `  --yt-spec-brand-button-background: ${accent};`,
      `  --yt-spec-badge-chip-background: ${hover};`,
      `  --yt-spec-10-percent-layer: ${border};`,
      `  --yt-spec-20-percent-layer: ${border};`,
      `  --yt-spec-30-percent-layer: ${border};`,
      `  --yt-spec-touch-response: ${hover};`,
      `  background: ${bg};`,
      `  color: ${fg};`,
      "}",
      `::selection { background: ${accent}; color: ${accentFg}; }`,
    ].join("\n");
  }

  function ensureObserver() {
    if (window.__ytdesktopThemeObserver) {
      return;
    }

    const observer = new MutationObserver(function () {
      const root = document.documentElement;
      const wantDark = window.__ytdesktopThemeMode === "dark";
      if (wantDark && !root.hasAttribute("dark")) {
        root.setAttribute("dark", "");
      } else if (!wantDark && root.hasAttribute("dark")) {
        root.removeAttribute("dark");
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["dark"],
    });
    window.__ytdesktopThemeObserver = observer;
  }

  function apply(theme) {
    if (!theme || typeof theme !== "object" || !document.documentElement) {
      return;
    }

    window.__ytdesktopThemeMode = theme.effectiveMode === "dark" ? "dark" : "light";

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    style.textContent = buildCss(theme);

    ensureObserver();

    const root = document.documentElement;
    if (window.__ytdesktopThemeMode === "dark") {
      if (!root.hasAttribute("dark")) {
        root.setAttribute("dark", "");
      }
    } else if (root.hasAttribute("dark")) {
      root.removeAttribute("dark");
    }
  }

  window.__ytdesktopApplyTheme = apply;

  function fetchTheme() {
    if (
      !window.__TAURI_INTERNALS__ ||
      typeof window.__TAURI_INTERNALS__.invoke !== "function"
    ) {
      return false;
    }

    window.__TAURI_INTERNALS__
      .invoke("theme_get")
      .then(apply)
      .catch(function () {
        // The backend may not be ready yet; the retry loop handles that.
      });

    return true;
  }

  if (!fetchTheme()) {
    let attempts = 0;
    const timer = window.setInterval(function () {
      attempts += 1;
      if (fetchTheme() || attempts > 100) {
        window.clearInterval(timer);
      }
    }, 50);
  }
})();
