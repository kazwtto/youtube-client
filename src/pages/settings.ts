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
} from "../lib/api";
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
  const [settings, themes] = await Promise.all([api.settingsGet(), api.themeList()]);
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
    <section class="page">
      <header class="page__header">
        <p class="eyebrow">${t("settings.eyebrow")}</p>
        <h1>${t("settings.title")}</h1>
        <p class="page__lead">${t("settings.lead")}</p>
      </header>

      <form class="settings" id="settings-form" novalidate>
        <section class="card">
          <div class="card__header">
            <h2>${t("settings.appearance")}</h2>
            <p class="muted">${t("settings.appearanceHint")}</p>
          </div>

          <div class="field-grid">
            <label class="field">
              <span>${t("settings.theme")}</span>
              <select name="themeId">${themeOptions}</select>
            </label>

            <label class="field">
              <span>${t("settings.mode")}</span>
              <select name="mode">
                <option value="system">${t("settings.modeSystem")}</option>
                <option value="light">${t("settings.modeLight")}</option>
                <option value="dark">${t("settings.modeDark")}</option>
              </select>
            </label>

            <label class="field">
              <span>${t("settings.language")}</span>
              <select name="language">${languageOptions}</select>
              <small class="muted">${t("settings.languageHint")}</small>
            </label>

            <label class="field">
              <span>${t("settings.backdrop")}</span>
              <select name="backdrop">
                <option value="mica">Mica</option>
                <option value="acrylic">${t("settings.backdropAcrylic")}</option>
                <option value="solid">${t("settings.backdropSolid")}</option>
              </select>
            </label>

            <label class="field">
              <span>${t("settings.accent")}</span>
              <input type="color" name="accent" />
            </label>

            <label class="field field--wide">
              <span>${t("settings.radius")} <output name="radiusValue">8</output> px</span>
              <input type="range" name="radius" min="2" max="24" step="1" />
            </label>

            <label class="field field--inline">
              <input type="checkbox" name="motion" />
              <span>${t("settings.motion")}</span>
            </label>
          </div>
        </section>

        <section class="card">
          <div class="card__header">
            <h2>${t("settings.rpcTitle")}</h2>
            <p class="muted">${t("settings.rpcHint")}</p>
          </div>

          <label class="field field--inline">
            <input type="checkbox" name="rpcEnabled" />
            <span>${t("settings.rpcEnabled")}</span>
          </label>

          <div class="field-grid">
            <label class="field">
              <span>${t("settings.rpcAppId")}</span>
              <input type="text" name="rpcAppId" placeholder="000000000000000000" />
            </label>

            <label class="field">
              <span>${t("settings.rpcMusicAppId")}</span>
              <input type="text" name="rpcMusicAppId" placeholder="000000000000000000" />
            </label>
          </div>

          <div class="check-grid">
            <label class="field field--inline">
              <input type="checkbox" name="rpcTimestamps" />
              <span>${t("settings.rpcTimestamps")}</span>
            </label>
            <label class="field field--inline">
              <input type="checkbox" name="rpcVideoButton" />
              <span>${t("settings.rpcVideoButton")}</span>
            </label>
            <label class="field field--inline">
              <input type="checkbox" name="rpcChannelButton" />
              <span>${t("settings.rpcChannelButton")}</span>
            </label>
            <label class="field field--inline">
              <input type="checkbox" name="rpcIdle" />
              <span>${t("settings.rpcIdle")}</span>
            </label>
          </div>
        </section>

        <section class="card">
          <div class="card__header">
            <h2>${t("settings.historyTitle")}</h2>
            <p class="muted">${t("settings.historyHint")}</p>
          </div>

          <label class="field field--inline">
            <input type="checkbox" name="historyEnabled" />
            <span>${t("settings.historyEnabled")}</span>
          </label>

          <div class="field-grid">
            <label class="field">
              <span>${t("settings.historyMinWatch")}</span>
              <input type="number" name="historyMinWatch" min="0" max="600" step="1" />
            </label>
          </div>

          <label class="field field--inline">
            <input type="checkbox" name="historyThumbnails" />
            <span>${t("settings.historyThumbnails")}</span>
          </label>
        </section>

        <div class="settings__actions">
          <button type="submit" class="button button--primary">${t("settings.save")}</button>
          <span class="status" id="settings-status" role="status"></span>
        </div>
      </form>
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
  const accentInput = form.querySelector<HTMLInputElement>('[name="accent"]')!;
  const radiusInput = form.querySelector<HTMLInputElement>('[name="radius"]')!;
  const radiusOutput = form.querySelector<HTMLOutputElement>('[name="radiusValue"]')!;
  const motionInput = form.querySelector<HTMLInputElement>('[name="motion"]')!;

  const rpcEnabled = form.querySelector<HTMLInputElement>('[name="rpcEnabled"]')!;
  const rpcAppId = form.querySelector<HTMLInputElement>('[name="rpcAppId"]')!;
  const rpcMusicAppId = form.querySelector<HTMLInputElement>('[name="rpcMusicAppId"]')!;
  const rpcTimestamps = form.querySelector<HTMLInputElement>('[name="rpcTimestamps"]')!;
  const rpcVideoButton = form.querySelector<HTMLInputElement>('[name="rpcVideoButton"]')!;
  const rpcChannelButton = form.querySelector<HTMLInputElement>('[name="rpcChannelButton"]')!;
  const rpcIdle = form.querySelector<HTMLInputElement>('[name="rpcIdle"]')!;

  const historyEnabled = form.querySelector<HTMLInputElement>('[name="historyEnabled"]')!;
  const historyMinWatch = form.querySelector<HTMLInputElement>('[name="historyMinWatch"]')!;
  const historyThumbnails = form.querySelector<HTMLInputElement>(
    '[name="historyThumbnails"]',
  )!;

  const status = host.querySelector<HTMLElement>("#settings-status")!;

  const syncForm = (value: AppSettings): void => {
    current = value;

    themeSelect.value = value.theme.themeId;
    modeSelect.value = value.theme.mode;
    languageSelect.value = normalizeLanguage(value.general.language);
    backdropSelect.value = value.theme.backdrop;
    accentInput.value = value.theme.accent;
    radiusInput.value = String(value.theme.radius);
    radiusOutput.textContent = String(value.theme.radius);
    motionInput.checked = value.theme.motion;

    rpcEnabled.checked = value.rpc.enabled;
    rpcAppId.value = value.rpc.appId;
    rpcMusicAppId.value = value.rpc.musicAppId;
    rpcTimestamps.checked = value.rpc.showTimestamps;
    rpcVideoButton.checked = value.rpc.showVideoButton;
    rpcChannelButton.checked = value.rpc.showChannelButton;
    rpcIdle.checked = value.rpc.idleWhenPaused;

    historyEnabled.checked = value.history.enabled;
    historyMinWatch.value = String(value.history.minimumWatchSecs);
    historyThumbnails.checked = value.history.keepThumbnails;
  };

  syncForm(current);

  radiusInput.addEventListener("input", () => {
    radiusOutput.textContent = radiusInput.value;
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void save();
  });

  async function save(): Promise<void> {
    const previousLanguage = normalizeLanguage(current.general.language);

    const next: AppSettings = {
      ...current,
      theme: {
        themeId: themeSelect.value,
        mode: modeSelect.value as ThemeMode,
        backdrop: backdropSelect.value as Backdrop,
        accent: accentInput.value,
        radius: Number(radiusInput.value) || 8,
        motion: motionInput.checked,
      },
      rpc: {
        ...current.rpc,
        enabled: rpcEnabled.checked,
        appId: rpcAppId.value.trim(),
        musicAppId: rpcMusicAppId.value.trim(),
        showVideoButton: rpcVideoButton.checked,
        showChannelButton: rpcChannelButton.checked,
        showTimestamps: rpcTimestamps.checked,
        idleWhenPaused: rpcIdle.checked,
      },
      history: {
        ...current.history,
        enabled: historyEnabled.checked,
        minimumWatchSecs: Math.max(0, Number(historyMinWatch.value) || 0),
        keepThumbnails: historyThumbnails.checked,
      },
      general: {
        ...current.general,
        language: normalizeLanguage(languageSelect.value),
      },
    };

    try {
      status.textContent = t("settings.saving");
      current = await api.settingsUpdate(next);
      syncForm(current);
      status.textContent = t("settings.saved");

      if (previousLanguage !== normalizeLanguage(current.general.language)) {
        window.location.reload();
      }
    } catch (error) {
      status.textContent = t("common.error", { error: String(error) });
    }
  }
}