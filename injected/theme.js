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
 *
 * Material layering (Mica / Acrylic)
 * ----------------------------------
 * The native backdrop belongs to the window. Instead of making every element
 * transparent, the site is organised into a small hierarchy of layers, the
 * same two-layer model Windows 11 uses for Mica apps:
 *
 *   0. Base     The window material itself. Visible in the masthead and in the
 *               navigation rail / guide, which sit directly on it.
 *   1. Sheet    One contiguous low-opacity layer behind the page content
 *               (`ytd-page-manager`). It is the only translucent surface under
 *               the content, so translucency never stacks.
 *   2. Raised   Cards and panels that sit on the sheet (description box,
 *               comments, playlist panels) are nearly opaque.
 *   3. Control  Chips, search field and buttons use a faint foreground wash.
 *   4. Flyout   Menus and dialogs are transient: acrylic, blurred, outlined.
 *
 * Sticky bars (masthead, chip bar) are frosted instead of tinted: they only
 * blur what scrolls beneath them, so they stay invisible at rest and never
 * form a seam against the base layer.
 */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------- *
   * 1. Constants
   * ---------------------------------------------------------------------- */

  const STYLE_ID = "ytdesktop-theme";
  const MOTION_STYLE_ID = "ytdesktop-motion";
  const MOTION_RESET = `
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  `;

  /// Opacity of each material layer, applied to the palette's `elevated` tone.
  const ALPHA = {
    sheet: { dark: 0.5, light: 0.6 },
    raised: 0.92,
    drawer: 0.82,
    flyout: 0.9,
  };

  const BLUR = {
    frame: "blur(24px) saturate(1.4)",
    drawer: "blur(30px) saturate(1.25)",
    flyout: "blur(30px) saturate(1.3)",
  };

  const RADIUS = {
    sheet: "8px",
  };

  /// Declarations that remove a component's own painted background.
  const CLEAR = {
    background: "transparent",
    "background-image": "none",
  };

  /// Prefixes that distinguish the persistent guide from the overlay drawer.
  const GUIDE_PERSISTENT = "ytd-app[guide-persistent-and-visible] ";
  const GUIDE_OVERLAY = "ytd-app:not([guide-persistent-and-visible]) ";

  /// Named groups of YouTube selectors, one group per role in the hierarchy.
  const SELECTORS = {
    // The application shell that hosts every other component.
    shell: ["ytd-app", "#content.ytd-app", "ytd-app > #content"],

    // Masthead: it sits on the base layer, like a title bar.
    masthead: [
      "ytd-masthead",
      "#masthead-container",
      "#background.ytd-masthead",
      "#content.ytd-masthead",
    ],
    mastheadBlur: ["#masthead-container"],
    mastheadGlass: ["#frosted-glass.ytd-app"],

    // Search field: the host stays clear, the field is a control.

    // Navigation: the persistent guide and the rail sit on the base layer; the
    // overlay drawer is a transient acrylic surface.
    guideHost: ["#guide"],
    guidePanel: [
      "#guide-content",
      "#contentContainer.ytd-app-drawer",
      "tp-yt-app-drawer > #contentContainer",
    ],
    guideInner: ["ytd-guide-renderer", "#guide-inner-content"],
    rail: ["ytd-mini-guide-renderer", "#mini-guide"],

    // The content sheet.
    sheet: ["ytd-page-manager"],

    // Structural containers inside the sheet. They only organise content, so
    // they must not paint anything of their own.
    structure: [
      "ytd-browse",
      "ytd-watch-flexy",
      "ytd-search",
      "ytd-channel",
      "ytd-two-column-browse-results-renderer",
      "ytd-two-column-search-results-renderer",
      "#columns",
      "#primary",
      "#secondary",
      "#below",
      "ytd-comments",
      "ytd-item-section-renderer",
      "ytd-watch-next-secondary-results-renderer",
      "ytd-rich-grid-renderer",
      "ytd-rich-grid-row",
      "ytd-rich-section-renderer",
      "ytd-rich-item-renderer",
      "ytd-shelf-renderer",
      "ytd-reel-shelf-renderer",
      "ytd-horizontal-card-list-renderer",
    ],

    // Filter chips: the bar is clear, the sticky wrapper is frosted.
    chipBar: ["ytd-feed-filter-chip-bar-renderer", "#chips"],
    chipSticky: ["ytd-feed-filter-chip-bar-renderer #chips-wrapper"],

    // Transient surfaces.
    flyout: [
      "ytd-menu-popup-renderer",
      "ytd-multi-page-menu-renderer",
      "tp-yt-paper-dialog",
    ],
  };

  /* ---------------------------------------------------------------------- *
   * 2. Color and CSS helpers
   * ---------------------------------------------------------------------- */

  function tokenValue(theme, name, fallback) {
    const tokens = theme && theme.tokens ? theme.tokens : {};
    const value = tokens[name];
    return typeof value === "string" && value ? value : fallback;
  }

  /// Returns `color` with the given opacity, keeping the palette's hue. It
  /// understands `#rgb`, `#rrggbb`, `#rrggbbaa` and `rgb()/rgba()`; any other
  /// CSS color is mixed with `transparent` by the engine.
  function withAlpha(color, alpha) {
    const value = String(color).trim();
    const opacity = Math.min(1, Math.max(0, alpha));

    let match = /^#([0-9a-f]{3})$/i.exec(value);
    if (match) {
      const channels = match[1].split("").map(function (digit) {
        return parseInt(digit + digit, 16);
      });
      return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${opacity})`;
    }

    match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value);
    if (match) {
      const numeric = parseInt(match[1], 16);
      const red = (numeric >> 16) & 255;
      const green = (numeric >> 8) & 255;
      const blue = numeric & 255;
      return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
    }

    match = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i.exec(
      value,
    );
    if (match) {
      return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${opacity})`;
    }

    return `color-mix(in srgb, ${value} ${Math.round(opacity * 100)}%, transparent)`;
  }

  /// Serialises a property map into `!important` declarations. Every
  /// declaration is `!important` because YouTube defines the same custom
  /// properties on `:root` and `html[dark]`, which would otherwise win the
  /// cascade (light themes) or tie with our runtime-appended sheet.
  function declare(properties) {
    return Object.keys(properties)
      .map(function (name) {
        return `  ${name}: ${properties[name]} !important;`;
      })
      .join("\n");
  }

  function rule(selector, properties) {
    return `${selector} {\n${declare(properties)}\n}`;
  }

  /// Builds a selector list from a named group. The `html body` prefix
  /// outranks YouTube's own element selectors; `lead` narrows the group to a
  /// state of the application (for instance the overlay guide).
  function scope(selectors, lead) {
    const prefix = lead || "";
    return selectors
      .map(function (selector) {
        return `html body ${prefix}${selector}`;
      })
      .join(", ");
  }

  function frosted(filter) {
    return {
      "-webkit-backdrop-filter": filter,
      "backdrop-filter": filter,
    };
  }

  /* ---------------------------------------------------------------------- *
   * 3. Palette and surfaces
   * ---------------------------------------------------------------------- */

  /// Resolves every theme token the stylesheet needs, with fallbacks.
  function readPalette(theme) {
    const dark = Boolean(theme) && theme.effectiveMode === "dark";
    const material =
      Boolean(theme) && (theme.backdrop === "mica" || theme.backdrop === "acrylic");

    return {
      dark: dark,
      material: material,
      bg: tokenValue(theme, "--color-bg-solid", dark ? "#0f0f0f" : "#ffffff"),
      elevated: tokenValue(theme, "--color-bg-elevated", dark ? "#212121" : "#f9f9f9"),
      fg: tokenValue(theme, "--color-fg", dark ? "#f1f1f1" : "#0f0f0f"),
      muted: tokenValue(theme, "--color-fg-muted", dark ? "#aaaaaa" : "#606060"),
      border: tokenValue(
        theme,
        "--color-border",
        dark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.1)",
      ),
      hover: tokenValue(
        theme,
        "--color-hover",
        dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)",
      ),
      accent: (theme && theme.accent) || tokenValue(theme, "--color-accent", "#0a84ff"),
      accentFg: tokenValue(theme, "--color-accent-fg", "#ffffff"),
    };
  }

  /// Maps the palette onto the layers of the hierarchy. Without a native
  /// material every layer collapses to the opaque palette colors.
  function buildSurfaces(palette) {
    const controlHover = withAlpha(palette.fg, palette.dark ? 0.12 : 0.1);

    if (!palette.material) {
      return {
        canvas: palette.bg,
        sheet: null,
        raised: palette.elevated,
        brand: palette.bg,
        drawer: palette.elevated,
        flyout: palette.elevated,
        control: palette.hover,
        controlHover: controlHover,
      };
    }

    const raised = withAlpha(palette.elevated, ALPHA.raised);

    return {
      canvas: "transparent",
      sheet: withAlpha(palette.elevated, palette.dark ? ALPHA.sheet.dark : ALPHA.sheet.light),
      raised: raised,
      brand: raised,
      drawer: withAlpha(palette.elevated, ALPHA.drawer),
      flyout: withAlpha(palette.elevated, ALPHA.flyout),
      control: palette.hover,
      controlHover: controlHover,
    };
  }

  /* ---------------------------------------------------------------------- *
   * 4. Stylesheet sections
   * ---------------------------------------------------------------------- */

  /// YouTube's design tokens, mapped onto the palette and the layers.
  function variablesCss(palette, surfaces) {
    const strokes = palette.material
      ? [
          palette.border,
          withAlpha(palette.fg, palette.dark ? 0.16 : 0.14),
          withAlpha(palette.fg, palette.dark ? 0.24 : 0.2),
        ]
      : [palette.border, palette.border, palette.border];

    const tokens = {
      // Backgrounds, from the page canvas up to raised panels.
      "--yt-spec-base-background": surfaces.canvas,
      "--yt-spec-general-background-a": surfaces.canvas,
      "--yt-spec-general-background-b": surfaces.canvas,
      "--yt-spec-general-background-c": surfaces.canvas,
      "--yt-spec-raised-background": surfaces.raised,
      "--yt-spec-menu-background": surfaces.flyout,
      "--yt-spec-brand-background-solid": surfaces.brand,
      "--yt-spec-brand-background-primary": surfaces.brand,
      "--yt-spec-brand-background-secondary": surfaces.brand,

      // Text and icons.
      "--yt-spec-text-primary": palette.fg,
      "--yt-spec-text-primary-inverse": palette.bg,
      "--yt-spec-text-secondary": palette.muted,
      "--yt-spec-text-disabled": palette.muted,
      "--yt-spec-icon-active-other": palette.fg,
      "--yt-spec-icon-inactive": palette.muted,
      "--yt-spec-icon-disabled": palette.muted,

      // Accent.
      "--yt-spec-call-to-action": palette.accent,
      "--yt-spec-suggested-action": palette.accent,
      "--yt-spec-themed-blue": palette.accent,
      "--yt-spec-brand-button-background": palette.accent,

      // Controls and strokes.
      "--yt-spec-badge-chip-background": surfaces.control,
      "--yt-spec-10-percent-layer": strokes[0],
      "--yt-spec-20-percent-layer": strokes[1],
      "--yt-spec-30-percent-layer": strokes[2],
      "--yt-spec-touch-response": surfaces.control,
    };

    if (palette.material) {
      tokens["--yt-spec-button-chip-background"] = surfaces.control;
      tokens["--yt-spec-button-chip-background-hover"] = surfaces.controlHover;
      tokens["--yt-spec-additive-background"] = surfaces.control;
      tokens["--yt-spec-outline"] = palette.border;
    }

    // Keep YouTube's original tokens in its search masthead and suggestions.
    return [
      `html { color-scheme: ${palette.dark ? "dark" : "light"}; }`,
      `ytd-page-manager, #guide.ytd-app, ytd-mini-guide-renderer.ytd-app {\n${declare(tokens)}\n}`,
    ];
  }

  /// The document canvas and text selection.
  function canvasCss(palette, surfaces) {
    return [
      rule("html, html[dark], body", {
        background: surfaces.canvas,
        color: palette.fg,
      }),
      rule("html[data-ytdesktop-page-enter]", { background: palette.bg }),
      `::selection { background: ${palette.accent}; color: ${palette.accentFg}; }`,
    ];
  }

  /// Layer 0: shell, masthead and navigation sit directly on the window
  /// material. Only named structural components are cleared; buttons, chips,
  /// cards and every other component keep their own fills.
  function baseLayerCss(palette, surfaces) {
    return [
      rule(scope(SELECTORS.shell), CLEAR),

      // The masthead is a title bar. It stays clear at rest and blurs only
      // what scrolls under it. YouTube's own frosted element is neutralised
      // so a single blur source remains.
      rule(scope(SELECTORS.masthead), CLEAR),
      rule(
        scope(SELECTORS.mastheadGlass),
        Object.assign({}, CLEAR, frosted("none")),
      ),
      rule(scope(SELECTORS.mastheadBlur), frosted(BLUR.frame)),

      // Navigation. The persistent guide and the rail are part of the base
      // layer; the overlay drawer opens on top of content, so it is acrylic.
      rule(scope(SELECTORS.guideHost), CLEAR),
      rule(scope(SELECTORS.guidePanel, GUIDE_PERSISTENT), CLEAR),
      rule(
        scope(SELECTORS.guidePanel, GUIDE_OVERLAY),
        Object.assign(
          {
            background: surfaces.drawer,
            "box-shadow": `inset -1px 0 0 ${palette.border}`,
          },
          frosted(BLUR.drawer),
        ),
      ),
      rule(scope(SELECTORS.guideInner), CLEAR),
      rule(scope(SELECTORS.rail), CLEAR),
    ];
  }

  /// Layer 1: the content sheet and the structure inside it.
  function sheetLayerCss(palette, surfaces) {
    const hairline = `inset 0 1px 0 ${palette.border}`;
    const withNavigation = [
      scope(SELECTORS.sheet, "ytd-app[mini-guide-visible] "),
      scope(SELECTORS.sheet, GUIDE_PERSISTENT),
    ].join(", ");

    return [
      // One translucent surface for the whole page. A hairline marks its top
      // edge below the masthead.
      rule(scope(SELECTORS.sheet), {
        background: surfaces.sheet,
        "box-shadow": hairline,
        "min-height": "calc(100vh - var(--ytd-masthead-height, 56px))",
      }),

      // Next to the rail or the guide the sheet becomes a panel: rounded
      // corner and a hairline on its leading edge.
      rule(withNavigation, {
        "border-top-left-radius": RADIUS.sheet,
        "box-shadow": `${hairline}, inset 1px 0 0 ${palette.border}`,
      }),

      // Components that only organise content must not paint over the sheet.
      rule(scope(SELECTORS.structure), CLEAR),
    ];
  }

  /// Sticky bars: clear tint, frosted backdrop.
  function stickyCss() {
    return [
      rule(scope(SELECTORS.chipBar), CLEAR),
      rule(scope(SELECTORS.chipSticky), Object.assign({}, CLEAR, frosted(BLUR.frame))),
    ];
  }

  /// Transient surfaces: acrylic menus and dialogs, outlined like flyouts.
  function flyoutCss(palette, surfaces) {
    return [
      rule(
        scope(SELECTORS.flyout),
        Object.assign(
          {
            background: surfaces.flyout,
            outline: `1px solid ${palette.border}`,
            "outline-offset": "-1px",
          },
          frosted(BLUR.flyout),
        ),
      ),
    ];
  }

  function buildCss(theme) {
    const palette = readPalette(theme);
    const surfaces = buildSurfaces(palette);

    let rules = [].concat(variablesCss(palette, surfaces), canvasCss(palette, surfaces));

    if (palette.material) {
      rules = rules.concat(
        baseLayerCss(palette, surfaces),
        sheetLayerCss(palette, surfaces),
        stickyCss(),
        flyoutCss(palette, surfaces),
      );
    }

    return `${rules.join("\n")}\n${motionCss()}`;
  }

  function motionCss() {
    return `
      html[data-motion="off"] *,
      html[data-motion="off"] *::before,
      html[data-motion="off"] *::after { ${MOTION_RESET} }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { ${MOTION_RESET} }
      }
    `;
  }

  function shadowMotionCss() {
    return `
      :host-context(html[data-motion="off"]) *,
      :host-context(html[data-motion="off"]) *::before,
      :host-context(html[data-motion="off"]) *::after { ${MOTION_RESET} }
      @media (prefers-reduced-motion: reduce) {
        :host, :host *, :host *::before, :host *::after { ${MOTION_RESET} }
      }
    `;
  }

  function addShadowMotionStyle(shadowRoot) {
    if (shadowRoot.querySelector(`#${MOTION_STYLE_ID}`)) {
      return;
    }
    const style = document.createElement("style");
    style.id = MOTION_STYLE_ID;
    style.textContent = shadowMotionCss();
    shadowRoot.appendChild(style);
  }

  function scanShadowRoots(node) {
    if (node instanceof Element && node.shadowRoot) {
      addShadowMotionStyle(node.shadowRoot);
      scanShadowRoots(node.shadowRoot);
    }
    if (typeof node.querySelectorAll !== "function") {
      return;
    }
    for (const child of node.querySelectorAll("*")) {
      if (child.shadowRoot) {
        addShadowMotionStyle(child.shadowRoot);
        scanShadowRoots(child.shadowRoot);
      }
    }
  }

  function cancelActiveAnimations() {
    if (typeof document.getAnimations !== "function") return;
    for (const animation of document.getAnimations()) {
      try {
        animation.cancel();
      } catch (_) {
        // Keep disabling the remaining animations if one cannot be canceled.
      }
    }
  }

  function ensureMotionSupport() {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motionDisabled = function () {
      return document.documentElement.dataset.motion === "off" || reducedMotion.matches;
    };

    if (motionDisabled()) cancelActiveAnimations();

    if (window.__ytdesktopMotionObserver) {
      return;
    }

    if (typeof reducedMotion.addEventListener === "function") {
      reducedMotion.addEventListener("change", function (event) {
        if (event.matches) cancelActiveAnimations();
      });
    }

    let shadowHookInstalled = false;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "attachShadow");
      const attachShadow = Element.prototype.attachShadow;
      Object.defineProperty(Element.prototype, "attachShadow", {
        ...descriptor,
        value: function (init) {
          const shadowRoot = attachShadow.call(this, init);
          addShadowMotionStyle(shadowRoot);
          return shadowRoot;
        },
      });
      shadowHookInstalled = true;
    } catch {
      // The observer below still catches open shadow roots if the hook is unavailable.
    }

    const animate = Element.prototype.animate;
    if (typeof animate === "function") {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
        Object.defineProperty(Element.prototype, "animate", {
          ...descriptor,
          value: function (keyframes, options) {
            if (!motionDisabled()) {
              return animate.call(this, keyframes, options);
            }
            const reducedOptions = typeof options === "number"
              ? 0
              : { ...(options || {}), delay: 0, duration: 0, iterations: 1 };
            return animate.call(this, keyframes, reducedOptions);
          },
        });
      } catch {
        // CSS animations and transitions are still disabled by the injected styles.
      }
    }

    scanShadowRoots(document.documentElement);
    if (shadowHookInstalled) {
      window.__ytdesktopMotionObserver = true;
      return;
    }

    const observer = new MutationObserver(function (mutations) {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          scanShadowRoots(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__ytdesktopMotionObserver = observer;
  }

  /* ---------------------------------------------------------------------- *
   * 5. Applying the theme
   * ---------------------------------------------------------------------- */

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

    window.__ytdesktopLastTheme = theme;
    window.__ytdesktopThemeMode = theme.effectiveMode === "dark" ? "dark" : "light";
    const root = document.documentElement;
    root.dataset.motion = theme.motion === false ? "off" : "on";

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
    }
    style.textContent = buildCss(theme);

    // YouTube injects its own `!important` background rules for `html[dark]`
    // after ours. A sheet placed before them loses the cascade tie and paints
    // the page canvas opaque, hiding the window material. Keep ours as the
    // last stylesheet in the document so the transparent background wins.
    const parent = document.body || document.head || document.documentElement;
    if (parent.lastElementChild !== style) {
      parent.appendChild(style);
    }

    ensureObserver();
    ensureMotionSupport();

    if (window.__ytdesktopThemeMode === "dark") {
      if (!root.hasAttribute("dark")) {
        root.setAttribute("dark", "");
      }
    } else if (root.hasAttribute("dark")) {
      root.removeAttribute("dark");
    }
  }

  window.__ytdesktopApplyTheme = apply;

  let pageEntryAnimation;
  window.__ytdesktopAnimatePageEntry = function () {
    if (window !== window.top) return;
    const root = document.documentElement;
    if (root.dataset.motion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const page = document.querySelector("ytd-page-manager");
    if (!page || pageEntryAnimation?.playState === "running") return;

    root.setAttribute("data-ytdesktop-page-enter", "");
    // Match the launcher route animation without replacing YouTube's transform.
    const animation = page.animate(
      [{ opacity: 0, translate: "0 4px" }, { opacity: 1, translate: "0 0" }],
      { duration: 160, easing: "ease-out" },
    );
    pageEntryAnimation = animation;
    const clear = () => {
      if (pageEntryAnimation !== animation) return;
      root.removeAttribute("data-ytdesktop-page-enter");
      pageEntryAnimation = undefined;
    };
    animation.finished.then(clear, clear);
  };

  let surfaceGeneration;
  window.__ytdesktopWaitForSurface = function (generation, animate) {
    if (window !== window.top || surfaceGeneration === generation) return;
    surfaceGeneration = generation;

    const wait = () => {
      if (surfaceGeneration !== generation) return;
      const pages = document.querySelectorAll("ytd-page-manager > :not([hidden]), main, [role=main]");
      const hasContent = Array.from(pages).some((page) =>
        page.firstElementChild && page.getBoundingClientRect().height > 0,
      );
      if (!hasContent) {
        window.setTimeout(wait, 100);
        return;
      }

      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (surfaceGeneration !== generation) return;
        if (animate) window.__ytdesktopAnimatePageEntry();
        window.__TAURI_INTERNALS__.invoke("youtube_surface_painted", { generation }).catch(console.error);
      }));
    };
    wait();
  };

  function rememberYoutubePage() {
    if (window !== window.top || !window.__TAURI_INTERNALS__ || !window.__TAURI_INTERNALS__.invoke) return;
    const url = window.location.href;
    if (url === lastRememberedPage) return;
    lastRememberedPage = url;
    window.__TAURI_INTERNALS__
      .invoke("remember_youtube_page", { url })
      .catch(function () {
        lastRememberedPage = "";
      });
  }

  if (window === window.top) {
    window.addEventListener("load", rememberYoutubePage, { once: true });
    window.addEventListener("yt-navigate-finish", rememberYoutubePage);
    window.addEventListener("popstate", rememberYoutubePage);
  }

  // Runs from the native page-load hook after every navigation: YouTube
  // rewrites its head styles during SPA navigation, so the theme sheet is
  // re-appended as the last stylesheet once the page is live.
  window.__ytdesktopReapplyTheme = function () {
    if (window.__ytdesktopLastTheme) {
      apply(window.__ytdesktopLastTheme);
    } else {
      fetchTheme();
    }
  };

  if (window === window.top) {
    let themeReapplyFrame = 0;
    window.addEventListener("yt-navigate-finish", () => {
      if (themeReapplyFrame) cancelAnimationFrame(themeReapplyFrame);
      themeReapplyFrame = requestAnimationFrame(() => {
        themeReapplyFrame = requestAnimationFrame(() => {
          themeReapplyFrame = 0;
          window.__ytdesktopReapplyTheme();
        });
      });
    });
  }

  /* ---------------------------------------------------------------------- *
   * 6. Bootstrap
   * ---------------------------------------------------------------------- */

  const MASTHEAD_STYLE_ID = "ytdesktop-masthead-hide";
  const SEARCH_SUGGESTION_STYLE_ID = "ytdesktop-search-suggestions";
  const removedGuideHeaders = new Map();
  const guideHeaderObservers = new Map();
  const searchSuggestionPopups = new Map();
  const searchSuggestionObservers = new Map();
  const SEARCH_POPUP_SELECTORS = [
    ".ytSearchboxComponentSuggestionsContainer",
    "yt-searchbox [role='listbox']",
    "ytd-searchbox [role='listbox']",
    "yt-searchbox #suggestions",
    "ytd-searchbox #suggestions",
    ".gstl_50",
    ".sbsb_a",
  ];
  const SEARCH_INPUT_SELECTORS = [
    "ytd-searchbox input#search",
    "ytd-searchbox input[name='search_query']",
    "yt-searchbox input",
    ".ytSearchboxComponentInput",
    ".ytSearchboxComponentInputTextArea",
    "input#searchbox-input",
    "input#search",
    "input[name='search_query']",
    "textarea[name='search_query']",
  ];
  let searchSuggestionInput = null;
  let searchSuggestionInputStyles = null;
  let searchSuggestionTimer = 0;
  let searchSuggestionLayout = null;

  function youtubeSearchRoots() {
    const masthead = document.querySelector("#masthead-container") || document.querySelector("ytd-masthead");
    if (!masthead) return [];
    const roots = [masthead];
    const visited = new Set();
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      if (!root || visited.has(root)) continue;
      visited.add(root);
      if (root.shadowRoot) roots.push(root.shadowRoot);
      if (typeof root.querySelectorAll !== "function") continue;
      root.querySelectorAll("*").forEach((element) => {
        if (element.shadowRoot) roots.push(element.shadowRoot);
      });
    }
    return Array.from(visited);
  }

  function visitSearchRoots(callback) {
    for (const root of youtubeSearchRoots()) callback(root);
  }

  function findYoutubeSearchInput() {
    let found = null;
    const roots = youtubeSearchRoots();
    if (!roots.length) roots.push(document);
    for (const root of roots) {
      if (found) break;
      if (typeof root.querySelector !== "function") continue;
      for (const selector of SEARCH_INPUT_SELECTORS) {
        const field = root.querySelector(selector);
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
          found = field;
          break;
        }
      }
    }
    return found;
  }

  function setInlineProperties(element, properties) {
    const previous = new Map();
    for (const [name, value] of Object.entries(properties)) {
      previous.set(name, [element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
      element.style.setProperty(name, value, "important");
    }
    return previous;
  }

  function restoreInlineProperties(element, previous) {
    if (!element || !previous) return;
    for (const [name, [value, priority]] of previous) {
      if (value) element.style.setProperty(name, value, priority);
      else element.style.removeProperty(name);
    }
  }

  function findYoutubeSearchPopups() {
    const found = [];
    const roots = [document, ...youtubeSearchRoots()];
    for (const root of roots) {
      if (typeof root.querySelectorAll !== "function") continue;
      for (const selector of SEARCH_POPUP_SELECTORS) {
        root.querySelectorAll(selector).forEach((popup) => {
          if (!found.includes(popup)) found.push(popup);
        });
      }
    }
    return found;
  }

  function positionYoutubeSearchPopups() {
    if (!searchSuggestionLayout) return;
    const [left, width] = searchSuggestionLayout;
    for (const popup of findYoutubeSearchPopups()) {
      if (!popup.getClientRects().length) continue;
      if (!searchSuggestionPopups.has(popup)) {
        searchSuggestionPopups.set(popup, setInlineProperties(popup, {
          position: "fixed",
          top: "0px",
          left: `${left}px`,
          width: `${width}px`,
          margin: "0px",
          transform: "none",
          "z-index": "2147483646",
          visibility: "visible",
          "pointer-events": "auto",
        }));
      } else {
        popup.style.setProperty("left", `${left}px`, "important");
        popup.style.setProperty("width", `${width}px`, "important");
      }
    }
  }

  function closeYoutubeSearchSuggestions() {
    window.clearTimeout(searchSuggestionTimer);
    searchSuggestionTimer = 0;
    searchSuggestionLayout = null;
    for (const observer of searchSuggestionObservers.values()) observer.disconnect();
    searchSuggestionObservers.clear();
    for (const [popup, previous] of searchSuggestionPopups) {
      restoreInlineProperties(popup, previous);
    }
    searchSuggestionPopups.clear();
    document.documentElement?.removeAttribute("data-ytdesktop-suggestions");
    if (searchSuggestionInput) {
      searchSuggestionInput.blur();
      restoreInlineProperties(searchSuggestionInput, searchSuggestionInputStyles);
    }
    searchSuggestionInput = null;
    searchSuggestionInputStyles = null;
  }

  document.addEventListener("pointerdown", (event) => {
    const path = event.composedPath();
    const insidePopup = Array.from(searchSuggestionPopups.keys()).some(
      (popup) => path.includes(popup) || popup.contains(event.target),
    );
    if (!insidePopup) closeYoutubeSearchSuggestions();
  }, true);
  window.addEventListener("yt-navigate-start", closeYoutubeSearchSuggestions);

  function observeYoutubeSearchRoot(root) {
    if (searchSuggestionObservers.has(root)) return;
    const observer = new MutationObserver(() => {
      visitSearchRoots(observeYoutubeSearchRoot);
      positionYoutubeSearchPopups();
    });
    const options = { childList: true, subtree: true };
    if (root !== document.documentElement) {
      options.attributes = true;
      options.attributeFilter = ["hidden", "class", "aria-hidden"];
    }
    observer.observe(root, options);
    searchSuggestionObservers.set(root, observer);
  }

  function updateYoutubeSearchSuggestions(query, left, width, attempt = 0) {
    window.clearTimeout(searchSuggestionTimer);
    if (!width || !document.documentElement) {
      closeYoutubeSearchSuggestions();
      return;
    }

    searchSuggestionLayout = [left, width];
    document.documentElement.setAttribute("data-ytdesktop-suggestions", "");

    let style = document.getElementById(SEARCH_SUGGESTION_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = SEARCH_SUGGESTION_STYLE_ID;
      style.textContent = `
        html[data-ytdesktop-suggestions] #masthead-container,
        html[data-ytdesktop-suggestions] ytd-masthead {
          display: block !important;
          position: fixed !important;
          inset: 0 auto auto 0 !important;
          width: 100% !important;
          height: 56px !important;
          min-height: 56px !important;
          max-height: none !important;
          overflow: visible !important;
          visibility: hidden !important;
          pointer-events: none !important;
          z-index: 2147483645 !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    const field = findYoutubeSearchInput();
    if (!field) {
      if (attempt < 20) {
        searchSuggestionTimer = window.setTimeout(
          () => updateYoutubeSearchSuggestions(query, left, width, attempt + 1),
          100,
        );
      } else {
        closeYoutubeSearchSuggestions();
      }
      return;
    }

    let shouldFocusField = false;
    if (field !== searchSuggestionInput) {
      if (searchSuggestionInput) {
        searchSuggestionInput.blur();
        restoreInlineProperties(searchSuggestionInput, searchSuggestionInputStyles);
      }
      searchSuggestionInput = field;
      searchSuggestionInputStyles = setInlineProperties(field, {
        visibility: "visible",
        opacity: "0",
        "pointer-events": "none",
      });
      shouldFocusField = true;
    }

    const prototype = field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(field, query);
    // YouTube checks document.activeElement before opening autocomplete;
    // dispatching focus events alone does not update it.
    if (shouldFocusField) field.focus({ preventScroll: true });
    field.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data: query.slice(-1),
    }));

    if (document.documentElement) observeYoutubeSearchRoot(document.documentElement);
    visitSearchRoots(observeYoutubeSearchRoot);
    positionYoutubeSearchPopups();
    requestAnimationFrame(positionYoutubeSearchPopups);
  }

  window.__ytdesktopSearchSuggestions = {
    update: updateYoutubeSearchSuggestions,
    close: closeYoutubeSearchSuggestions,
  };

  function isGuideHeader(header) {
    let node = header;
    while (node) {
      if (node.id === "guide-content") return true;
      if (node.parentElement) {
        node = node.parentElement;
      } else {
        node = node.getRootNode()?.host || null;
      }
    }
    return false;
  }

  function removeGuideHeadersIn(node) {
    const roots = [node];
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      if (!root || typeof root.querySelectorAll !== "function") continue;
      if (root.nodeType === Node.ELEMENT_NODE && root.shadowRoot) roots.push(root.shadowRoot);
      root.querySelectorAll("*").forEach((element) => {
        if (element.shadowRoot) roots.push(element.shadowRoot);
      });
      const headers = [];
      if (root.nodeType === Node.ELEMENT_NODE && root.id === "header") headers.push(root);
      headers.push(...root.querySelectorAll("#header"));
      for (const header of headers) {
        if (!isGuideHeader(header) || removedGuideHeaders.has(header)) continue;
        removedGuideHeaders.set(header, { parent: header.parentNode, next: header.nextSibling });
        header.remove();
      }
    }
  }

  function restoreGuideHeaders() {
    for (const observer of guideHeaderObservers.values()) observer.disconnect();
    guideHeaderObservers.clear();
    for (const [header, position] of removedGuideHeaders) {
      const { parent, next } = position;
      if (parent?.isConnected && !parent.querySelector?.("#header")) {
        parent.insertBefore(header, next?.parentNode === parent ? next : null);
      }
    }
    removedGuideHeaders.clear();
  }

  function observeGuideRoot(root) {
    if (guideHeaderObservers.has(root)) return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          removeGuideHeadersIn(node);
          observeGuideRootsIn(node);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    guideHeaderObservers.set(root, observer);
  }

  function observeGuideRootsIn(node) {
    if (node.nodeType === Node.ELEMENT_NODE && node.shadowRoot) observeGuideRoot(node.shadowRoot);
    node.querySelectorAll("*").forEach((element) => {
      if (element.shadowRoot) observeGuideRoot(element.shadowRoot);
    });
  }

  function watchGuideHeaders() {
    if (guideHeaderObservers.size || !document.documentElement) return;
    removeGuideHeadersIn(document);
    observeGuideRoot(document.documentElement);
    observeGuideRootsIn(document.documentElement);
  }

  function setMastheadIntegrated(integrated) {
    integrated = Boolean(integrated);
    window.__ytdesktopInitialMastheadIntegrated = integrated;
    let style = document.getElementById(MASTHEAD_STYLE_ID);
    if (!integrated) {
      closeYoutubeSearchSuggestions();
      if (style) style.remove();
      restoreGuideHeaders();
    } else if (!style) {
      style = document.createElement("style");
      style.id = MASTHEAD_STYLE_ID;
      style.textContent = `
        #masthead-container, ytd-masthead, #ticker.ytd-masthead, #interstitial.ytd-masthead {
          display: none !important;
          height: 0 !important;
          min-height: 0 !important;
          max-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          pointer-events: none !important;
          visibility: hidden !important;
        }
        #frosted-glass {
          display: none !important;
        }
        :root, html, body, ytd-app {
          --ytd-masthead-height: 0px !important;
          --ytd-toolbar-offset: 0px !important;
        }
        ytd-page-manager#page-manager {
          margin-top: 0px !important;
          padding-top: 0px !important;
        }
        #guide.ytd-app, ytd-mini-guide-renderer.ytd-app, #contentContainer.tp-yt-app-drawer {
          top: 0px !important;
          padding-top: 0px !important;
        }
      `;
      const parent = document.head || document.documentElement;
      if (parent) parent.appendChild(style);
    }

    if (integrated) watchGuideHeaders();
  }

  function applyMastheadIntegration() {
    setMastheadIntegrated(window.__ytdesktopInitialMastheadIntegrated);
  }

  window.__ytdesktopSetMastheadIntegrated = function (integrated) {
    setMastheadIntegrated(integrated);
  };

  // The backend embeds the resolved theme in this script, and initialization
  // scripts run before the page is parsed. Apply it synchronously so YouTube's
  // first paint is already themed instead of flashing its default surface.
  (function applyInitialTheme() {
    applyMastheadIntegration();
    const initial = window.__ytdesktopInitialTheme;
    if (!initial) {
      return;
    }

    if (document.documentElement) {
      apply(initial);
    } else {
      document.addEventListener(
        "readystatechange",
        function () {
          applyMastheadIntegration();
          if (document.documentElement) {
            apply(initial);
          }
        },
        { once: true },
      );
    }
  })();

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
