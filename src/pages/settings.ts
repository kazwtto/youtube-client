import {
  LANGUAGES,
  normalizeLanguage,
  t,
  type TranslationKey,
} from "../i18n";
import {
  api,
  type AppSettings,
  type Backdrop,
  type ThemeMode,
  type ThemeSummary,
  type TitlebarStyle,
} from "../lib/api";
import { enhanceSelect, type SelectEnhancer } from "../components/select";
import { escapeHtml } from "../lib/html";

const THEME_NAME_KEYS: Record<string, TranslationKey> = {
  fluent: "themes.fluent.name",
  "high-contrast": "themes.highContrast.name",
};

function themeName(theme: ThemeSummary): string {
  const key = THEME_NAME_KEYS[theme.id];
  return key ? t(key) : theme.name;
}

export async function renderSettings(host: HTMLElement): Promise<void> {
  const [settings, themes, version] = await Promise.all([
    api.settingsGet(),
    api.themeList(),
    api.appVersion(),
  ]);
  let current = settings;

  const themeOptions = themes
    .map(
      (theme) =>
        `<option value="${escapeHtml(theme.id)}">${escapeHtml(themeName(theme))}</option>`,
    )
    .join("");

  const languageOptions = LANGUAGES.map(
    (language) =>
      `<option value="${language.id}">${escapeHtml(language.label)}</option>`,
  ).join("");

  host.innerHTML = `
    <section class="page page--settings">
      <header class="page__header">
        <div>
          <h1>${t("settings.title")}</h1>
          <p class="page__lead">${t("settings.lead")}</p>
        </div>
      </header>

      <div class="settings-layout">
        <nav class="settings-nav" role="tablist" aria-label="${t("settings.title")}">
          <button type="button" role="tab" class="settings-nav__item is-active" data-tab="appearance" aria-selected="true">${t("settings.appearance")}</button>
          <button type="button" role="tab" class="settings-nav__item" data-tab="pip" aria-selected="false">${t("settings.pipTitle")}</button>
          <button type="button" role="tab" class="settings-nav__item" data-tab="history" aria-selected="false">${t("settings.historyTitle")}</button>
          <button type="button" role="tab" class="settings-nav__item" data-tab="app" aria-selected="false">${t("settings.application")}</button>
        </nav>

        <form class="settings" id="settings-form" novalidate>
          <p class="settings__status" id="settings-status" role="status" aria-live="polite" data-state="idle">
            <span class="settings__status-dot" aria-hidden="true"></span>
            <span></span>
          </p>

          <section class="yt-section" id="settings-appearance" data-tab-panel="appearance">
            <h2 class="yt-section__title">${t("settings.appearance")}</h2>
            <p class="yt-section__hint">${t("settings.appearanceHint")}</p>

            <label class="yt-setting">
              <span class="yt-setting__text"><span class="yt-setting__label">${t("settings.theme")}</span></span>
              <span class="yt-setting__control">
                <select class="yt-select" name="themeId">${themeOptions}</select>
              </span>
            </label>

            <label class="yt-setting">
              <span class="yt-setting__text"><span class="yt-setting__label">${t("settings.mode")}</span></span>
              <span class="yt-setting__control">
                <select class="yt-select" name="mode">
                  <option value="system">${t("settings.modeSystem")}</option>
                  <option value="light">${t("settings.modeLight")}</option>
                  <option value="dark">${t("settings.modeDark")}</option>
                </select>
              </span>
            </label>

            <label class="yt-setting">
              <span class="yt-setting__text">
                <span class="yt-setting__label">${t("settings.language")}</span>
                <span class="yt-setting__hint">${t("settings.languageHint")}</span>
              </span>
              <span class="yt-setting__control">
                <select class="yt-select" name="language">${languageOptions}</select>
              </span>
            </label>

            <label class="yt-setting">
              <span class="yt-setting__text"><span class="yt-setting__label">${t("settings.backdrop")}</span></span>
              <span class="yt-setting__control">
                <select class="yt-select" name="backdrop">
                  <option value="mica">Mica</option>
                  <option value="acrylic">${t("settings.backdropAcrylic")}</option>
                  <option value="solid">${t("settings.backdropSolid")}</option>
                </select>
              </span>
            </label>

            <label class="yt-setting">
              <span class="yt-setting__text">
                <span class="yt-setting__label">${t("settings.radius")}</span>
              </span>
              <span class="yt-setting__control yt-setting__control--range">
                <input class="yt-range" type="range" name="radius" min="2" max="24" step="1" />
                <output class="yt-range-value" name="radiusValue">8</output>
              </span>
            </label>

            <label class="yt-setting">
              <span class="yt-setting__text"><span class="yt-setting__label">${t("settings.motion")}</span></span>
              <span class="yt-switch">
                <input type="checkbox" name="motion" />
                <span class="yt-switch__track" aria-hidden="true"></span>
              </span>
            </label>

            <label class="yt-setting">
              <span class="yt-setting__text"><span class="yt-setting__label">${t("settings.titlebarStyle")}</span></span>
              <span class="yt-setting__control">
                <select class="yt-select" name="titlebarStyle">
                  <option value="tabs">${t("settings.titlebarTabs")}</option>
                  <option value="icons">${t("settings.titlebarIcons")}</option>
                </select>
              </span>
            </label>
          </section>

          <section class="yt-section" id="settings-pip" data-tab-panel="pip" hidden>
            <h2 class="yt-section__title">${t("settings.pipTitle")}</h2>
            <p class="yt-section__hint">${t("settings.pipHint")}</p>

            <label class="yt-setting">
              <span class="yt-setting__text">
                <span class="yt-setting__label">${t("settings.pipEnabled")}</span>
                <span class="yt-setting__hint">${t("settings.pipEnabledHint")}</span>
              </span>
              <span class="yt-switch">
                <input type="checkbox" role="switch" name="pipEnabled" />
                <span class="yt-switch__track" aria-hidden="true"></span>
              </span>
            </label>

            <label class="yt-setting">
              <span class="yt-setting__text">
                <span class="yt-setting__label">${t("settings.pipMode")}</span>
                <span class="yt-setting__hint">${t("settings.pipModeHint")}</span>
              </span>
              <span class="yt-setting__control">
                <select class="yt-select" name="pipMode">
                  <option value="custom">${t("settings.pipModeCustom")}</option>
                  <option value="native">${t("settings.pipModeNative")}</option>
                </select>
              </span>
            </label>

            <label class="yt-setting">
              <span class="yt-setting__text">
                <span class="yt-setting__label">${t("settings.pipMinimize")}</span>
                <span class="yt-setting__hint">${t("settings.pipMinimizeHint")}</span>
              </span>
              <span class="yt-switch">
                <input type="checkbox" role="switch" name="pipOnMinimize" />
                <span class="yt-switch__track" aria-hidden="true"></span>
              </span>
            </label>

            <label class="yt-setting">
              <span class="yt-setting__text">
                <span class="yt-setting__label">${t("settings.pipBlur")}</span>
                <span class="yt-setting__hint">${t("settings.pipBlurHint")}</span>
              </span>
              <span class="yt-switch">
                <input type="checkbox" role="switch" name="pipOnBlur" />
                <span class="yt-switch__track" aria-hidden="true"></span>
              </span>
            </label>
          </section>

          <section class="yt-section" id="settings-history" data-tab-panel="history" hidden>
            <h2 class="yt-section__title">${t("settings.historyTitle")}</h2>
            <p class="yt-section__hint">${t("settings.historyHint")}</p>

            <label class="yt-setting">
              <span class="yt-setting__text"><span class="yt-setting__label">${t("settings.historyEnabled")}</span></span>
              <span class="yt-switch">
                <input type="checkbox" name="historyEnabled" />
                <span class="yt-switch__track" aria-hidden="true"></span>
              </span>
            </label>

            <label class="yt-setting">
              <span class="yt-setting__text">
                <span class="yt-setting__label">${t("settings.historyMinWatch")}</span>
              </span>
              <span class="yt-setting__control">
                <input class="yt-input yt-input--short" type="number" name="historyMinWatch" min="0" max="600" step="1" />
              </span>
            </label>

            <label class="yt-setting">
              <span class="yt-setting__text"><span class="yt-setting__label">${t("settings.historyThumbnails")}</span></span>
              <span class="yt-switch">
                <input type="checkbox" name="historyThumbnails" />
                <span class="yt-switch__track" aria-hidden="true"></span>
              </span>
            </label>
          </section>

          <section class="yt-section" id="settings-app" data-tab-panel="app" hidden>
            <h2 class="yt-section__title">${t("settings.application")}</h2>
            <p class="yt-section__hint">${t("settings.hardwareAccelerationHint")}</p>

            <label class="yt-setting">
              <span class="yt-setting__text"><span class="yt-setting__label">${t("settings.hardwareAcceleration")}</span></span>
              <span class="yt-switch">
                <input type="checkbox" name="hardwareAcceleration" />
                <span class="yt-switch__track" aria-hidden="true"></span>
              </span>
            </label>

            <div class="yt-setting">
              <span class="yt-setting__text">
                <span class="yt-setting__label">${t("settings.version")}</span>
                <span class="yt-setting__hint">YT Desktop ${escapeHtml(version)}</span>
              </span>
            </div>
          </section>
        </form>
      </div>
    </section>
  `;

  const form = host.querySelector<HTMLFormElement>("#settings-form");
  if (!form) {
    return;
  }

  const themeSelect = form.querySelector<HTMLSelectElement>('[name="themeId"]')!;
  const modeSelect = form.querySelector<HTMLSelectElement>('[name="mode"]')!;
  const languageSelect = form.querySelector<HTMLSelectElement>('[name="language"]')!;
  const backdropSelect = form.querySelector<HTMLSelectElement>('[name="backdrop"]')!;
  const radiusInput = form.querySelector<HTMLInputElement>('[name="radius"]')!;
  const radiusOutput = form.querySelector<HTMLOutputElement>('[name="radiusValue"]')!;
  const motionInput = form.querySelector<HTMLInputElement>('[name="motion"]')!;
  const titlebarStyleSelect = form.querySelector<HTMLSelectElement>('[name="titlebarStyle"]')!;
  const pipEnabled = form.querySelector<HTMLInputElement>('[name="pipEnabled"]')!;
  const pipModeSelect = form.querySelector<HTMLSelectElement>('[name="pipMode"]')!;
  const pipOnMinimize = form.querySelector<HTMLInputElement>('[name="pipOnMinimize"]')!;
  const pipOnBlur = form.querySelector<HTMLInputElement>('[name="pipOnBlur"]')!;


  const historyEnabled = form.querySelector<HTMLInputElement>('[name="historyEnabled"]')!;
  const historyMinWatch = form.querySelector<HTMLInputElement>('[name="historyMinWatch"]')!;
  const historyThumbnails = form.querySelector<HTMLInputElement>(
    '[name="historyThumbnails"]',
  )!;
  const hardwareAcceleration = form.querySelector<HTMLInputElement>(
    '[name="hardwareAcceleration"]',
  )!;

  const enhancers: SelectEnhancer[] = [];
  const status = host.querySelector<HTMLElement>("#settings-status")!;
  const statusText = status.querySelector<HTMLElement>("span:last-child")!;
  let languageAtLoad = normalizeLanguage(current.general.language);

  const syncForm = (value: AppSettings): void => {
    current = value;

    themeSelect.value = value.theme.themeId;
    modeSelect.value = value.theme.mode;
    languageSelect.value = normalizeLanguage(value.general.language);
    backdropSelect.value = value.theme.backdrop;
    radiusInput.value = String(value.theme.radius);
    radiusOutput.value = String(value.theme.radius);
    motionInput.checked = value.theme.motion;
    titlebarStyleSelect.value = value.general.titlebarStyle;
    pipEnabled.checked = value.pip.enabled;
    pipModeSelect.value = value.pip.mode;
    pipOnMinimize.checked = value.general.pipOnMinimize;
    pipOnBlur.checked = value.general.pipOnBlur;


    historyEnabled.checked = value.history.enabled;
    historyMinWatch.value = String(value.history.minimumWatchSecs);
    historyThumbnails.checked = value.history.keepThumbnails;
    hardwareAcceleration.checked = value.general.hardwareAcceleration;

    for (const enhancer of enhancers) {
      enhancer.sync();
    }
  };

  syncForm(current);

  for (const select of host.querySelectorAll<HTMLSelectElement>("select.yt-select")) {
    enhancers.push(enhanceSelect(select));
  }

  let timer: number | undefined;
  let statusTimer: number | undefined;
  let saving = false;
  let pending = false;

  const setStatus = (message: string, state: "idle" | "saving" | "saved" | "error"): void => {
    statusText.textContent = message;
    status.dataset.state = state;
  };

  const collect = (): AppSettings => ({
    ...current,
    theme: {
      themeId: themeSelect.value,
      mode: modeSelect.value as ThemeMode,
      backdrop: backdropSelect.value as Backdrop,
      accent: current.theme.accent,
      radius: Number(radiusInput.value) || 8,
      motion: motionInput.checked,
    },
    history: {
      ...current.history,
      enabled: historyEnabled.checked,
      minimumWatchSecs: Math.min(
        600,
        Math.max(0, Number(historyMinWatch.value) || 0),
      ),
      keepThumbnails: historyThumbnails.checked,
    },
    pip: {
      ...current.pip,
      enabled: pipEnabled.checked,
      mode: (pipModeSelect.value as "custom" | "native") || "custom",
    },
    general: {
      ...current.general,
      language: normalizeLanguage(languageSelect.value),
      hardwareAcceleration: hardwareAcceleration.checked,
      titlebarStyle: titlebarStyleSelect.value as TitlebarStyle,
      pipOnMinimize: pipOnMinimize.checked,
      pipOnBlur: pipOnBlur.checked,
    },
  });

  const save = async (): Promise<void> => {
    if (saving) {
      pending = true;
      return;
    }

    // `input` and `change` can both fire for the same edit; skip a save that
    // would not change anything so the theme is not re-applied twice.
    const next = collect();
    if (JSON.stringify(next) === JSON.stringify(current)) {
      return;
    }

    saving = true;
    setStatus(t("settings.saving"), "saving");

    try {
      current = await api.settingsUpdate(next);
      setStatus(t("settings.saved"), "saved");
      if (statusTimer !== undefined) {
        window.clearTimeout(statusTimer);
      }
      statusTimer = window.setTimeout(() => setStatus("", "idle"), 1600);

      const language = normalizeLanguage(current.general.language);
      if (language !== languageAtLoad) {
        languageAtLoad = language;
        window.location.reload();
      }
    } catch (error) {
      setStatus(t("common.error", { error: String(error) }), "error");
    } finally {
      saving = false;
      if (pending) {
        pending = false;
        queueSave(0);
      }
    }
  };

  const queueSave = (delay: number): void => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }

    timer = window.setTimeout(() => {
      timer = undefined;
      void save();
    }, delay);
  };

  const delayFor = (target: EventTarget | null): number => {
    if (target instanceof HTMLInputElement) {
      if (target.type === "range" || target.type === "color") {
        return 120;
      }
      if (target.type === "text" || target.type === "number") {
        return 500;
      }
    }
    return 0;
  };

  form.addEventListener("input", (event) => {
    // Selects and checkboxes are handled by `change`; saving on `input` too
    // would apply the theme twice for a single choice.
    if (
      event.target instanceof HTMLSelectElement ||
      (event.target instanceof HTMLInputElement && event.target.type === "checkbox")
    ) {
      return;
    }

    if (event.target === radiusInput) {
      radiusOutput.value = radiusInput.value;
    }
    queueSave(delayFor(event.target));
  });

  form.addEventListener("change", () => {
    queueSave(0);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    queueSave(0);
  });

  const navButtons = host.querySelectorAll<HTMLButtonElement>(".settings-nav__item");
  const tabPanels = host.querySelectorAll<HTMLElement>("[data-tab-panel]");

  function switchTab(tabId: string): void {
    for (const btn of navButtons) {
      const active = btn.dataset.tab === tabId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    }
    for (const panel of tabPanels) {
      panel.hidden = panel.dataset.tabPanel !== tabId;
    }
  }

  for (const btn of navButtons) {
    btn.addEventListener("click", () => {
      if (btn.dataset.tab) {
        switchTab(btn.dataset.tab);
      }
    });
  }
}
