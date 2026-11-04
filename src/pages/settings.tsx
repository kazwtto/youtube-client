import { For, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { render } from "solid-js/web";

import { LANGUAGES, normalizeLanguage, setLanguage, t, type TranslationKey } from "../i18n";
import { api, type AppSettings, type ThemeMode, type ThemeSummary, type TitlebarStyle } from "../lib/api";
import { Select, type SelectOption } from "../components/select";
import { SettingRow, SwitchSetting } from "../components/setting-row";

const THEME_NAME_KEYS: Record<string, TranslationKey> = {
  fluent: "themes.fluent.name",
  "high-contrast": "themes.highContrast.name",
};

const SETTINGS_TABS = ["appearance", "pip", "history", "app"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

interface SettingsPageProps {
  initial: AppSettings;
  themes: ThemeSummary[];
  version: string;
  initialTab: SettingsTab;
}

function SettingsPage(props: SettingsPageProps) {
  const [current, setCurrent] = createSignal(props.initial);
  const [activeTab, setActiveTab] = createSignal(props.initialTab);
  const [radius, setRadius] = createSignal(props.initial.theme.radius);
  const [horizontalTabs, setHorizontalTabs] = createSignal(window.matchMedia("(max-width: 900px)").matches);
  let form!: HTMLFormElement;
  let timer: number | undefined;
  let saving = false;
  let pending = false;
  let editVersion = 0;

  const themeOptions = (): readonly SelectOption[] => props.themes.map((theme) => ({
    value: theme.id,
    label: THEME_NAME_KEYS[theme.id] ? t(THEME_NAME_KEYS[theme.id]) : theme.name,
  }));
  const languageOptions = (): readonly SelectOption[] => LANGUAGES.map(({ id, label }) => ({
    value: id,
    label,
  }));
  const field = (name: string): HTMLInputElement =>
    form.elements.namedItem(name) as HTMLInputElement;
  const value = (name: string): string => field(name).value;
  const checked = (name: string): boolean => field(name).checked;

  const collect = (): AppSettings => {
    const base = current();
    return {
      ...base,
      theme: {
        ...base.theme,
        themeId: value("themeId"),
        mode: value("mode") as ThemeMode,
        backdrop: value("backdrop") as AppSettings["theme"]["backdrop"],
        radius: Math.min(24, Math.max(2, Number(value("radius")) || 8)),
        motion: checked("motion"),
      },
      history: {
        ...base.history,
        enabled: checked("historyEnabled"),
        minimumWatchSecs: Math.min(600, Math.max(0, Number(value("historyMinWatch")) || 0)),
        keepThumbnails: checked("historyThumbnails"),
      },
      pip: {
        ...base.pip,
        enabled: checked("pipEnabled"),
        mode: value("pipMode") as AppSettings["pip"]["mode"],
      },
      general: {
        ...base.general,
        language: normalizeLanguage(value("language")),
        hardwareAcceleration: checked("hardwareAcceleration"),
        titlebarStyle: value("titlebarStyle") as TitlebarStyle,
        integrateMasthead: checked("integrateMasthead"),
        pipOnMinimize: checked("pipOnMinimize"),
        pipOnBlur: checked("pipOnBlur"),
      },
    };
  };

  const queueSave = (delay: number): void => {
    editVersion += 1;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      void save();
    }, delay);
  };

  const save = async (): Promise<void> => {
    if (saving) {
      pending = true;
      return;
    }

    const next = collect();
    // `input` and `change` can both fire for the same edit; skip a save that
    // would not change anything so the theme is not re-applied twice.
    if (JSON.stringify(next) === JSON.stringify(current())) return;

    const savedVersion = editVersion;
    saving = true;
    try {
      const saved = await api.settingsUpdate(next);
      if (editVersion === savedVersion) {
        setCurrent(saved);
        setRadius(saved.theme.radius);
        setLanguage(saved.general.language);
      }
    } catch (error) {
      console.error(error);
    } finally {
      saving = false;
      if (pending) {
        pending = false;
        queueSave(0);
      }
    }
  };

  const activateTab = (tab: SettingsTab, focus = false): void => {
    setActiveTab(tab);
    if (focus) document.getElementById(`settings-tab-${tab}`)?.focus();
  };

  const handleTabKeyDown: JSX.EventHandlerUnion<HTMLElement, KeyboardEvent> = (event) => {
    const tab = (event.target as HTMLElement).dataset.tab as SettingsTab | undefined;
    if (!tab) return;
    const index = SETTINGS_TABS.indexOf(tab);
    const next = event.key === (horizontalTabs() ? "ArrowRight" : "ArrowDown")
      ? (index + 1) % SETTINGS_TABS.length
      : event.key === (horizontalTabs() ? "ArrowLeft" : "ArrowUp")
        ? (index + SETTINGS_TABS.length - 1) % SETTINGS_TABS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? SETTINGS_TABS.length - 1
            : -1;
    if (next < 0) return;
    event.preventDefault();
    activateTab(SETTINGS_TABS[next], true);
  };

  const delayFor = (target: EventTarget | null): number => {
    if (target instanceof HTMLInputElement) {
      if (target.type === "range" || target.type === "color") return 120;
      if (target.type === "text" || target.type === "number") return 500;
    }
    return 0;
  };

  onCleanup(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });

  onMount(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const updateOrientation = (): void => {
      setHorizontalTabs(media.matches);
    };
    media.addEventListener("change", updateOrientation);
    onCleanup(() => media.removeEventListener("change", updateOrientation));
  });

  return (
    <section class="page page--settings">
      <header class="page__header">
        <div>
          <h1>{t("settings.title")}</h1>
          <p class="page__lead">{t("settings.lead")}</p>
        </div>
      </header>

      <div class="settings-layout">
        <nav class="settings-nav" role="tablist" aria-orientation={horizontalTabs() ? "horizontal" : "vertical"} aria-label={t("settings.title")} onKeyDown={handleTabKeyDown}>
          <For each={SETTINGS_TABS}>
            {(tab) => {
              const key: TranslationKey = tab === "pip"
                ? "settings.pipTitle"
                : tab === "app"
                  ? "settings.application"
                  : tab === "history"
                    ? "settings.historyTitle"
                    : "settings.appearance";
              const label = (): string => t(key);
              return (
                <button
                  type="button"
                  id={`settings-tab-${tab}`}
                  class="settings-nav__item"
                  classList={{ "is-active": activeTab() === tab }}
                  role="tab"
                  data-tab={tab}
                  aria-controls={`settings-panel-${tab}`}
                  aria-selected={activeTab() === tab}
                  tabIndex={activeTab() === tab ? 0 : -1}
                  onClick={() => activateTab(tab)}
                >
                  {label()}
                </button>
              );
            }}
          </For>
        </nav>

        <form
          class="settings"
          id="settings-form"
          novalidate
          ref={form}
          onInput={(event) => {
            const target = event.target;
            // Selects and checkboxes are handled by `change`; saving on `input` too
            // would apply the theme twice for a single choice.
            if (target instanceof HTMLInputElement) {
              if (target.type === "checkbox") return;
              if (target.name === "radius") setRadius(Number(target.value));
            }
            queueSave(delayFor(target));
          }}
          onChange={() => queueSave(0)}
          onSubmit={(event) => {
            event.preventDefault();
            queueSave(0);
          }}
        >
          <section id="settings-panel-appearance" class="yt-section" role="tabpanel" aria-labelledby="settings-tab-appearance" tabIndex={0} hidden={activeTab() !== "appearance"}>
            <p class="yt-section__hint">{t("settings.appearanceHint")}</p>
            <SettingRow label={t("settings.theme")} control={
              <Select name="themeId" label={() => t("settings.theme")} value={() => current().theme.themeId} options={themeOptions} onChange={() => queueSave(0)} />
            } />
            <SettingRow label={t("settings.mode")} control={
              <Select name="mode" label={() => t("settings.mode")} value={() => current().theme.mode} options={() => [
                { value: "system", label: t("settings.modeSystem") },
                { value: "light", label: t("settings.modeLight") },
                { value: "dark", label: t("settings.modeDark") },
              ]} onChange={() => queueSave(0)} />
            } />
            <SettingRow label={t("settings.language")} hint={t("settings.languageHint")} control={
              <Select name="language" label={() => t("settings.language")} value={() => normalizeLanguage(current().general.language)} options={languageOptions} onChange={() => queueSave(0)} />
            } />
            <SettingRow label={t("settings.backdrop")} control={
              <Select name="backdrop" label={() => t("settings.backdrop")} value={() => current().theme.backdrop} options={() => [
                { value: "mica", label: t("settings.backdropMica") },
                { value: "acrylic", label: t("settings.backdropAcrylic") },
                { value: "solid", label: t("settings.backdropSolid") },
              ]} onChange={() => queueSave(0)} />
            } />

            <label class="yt-setting">
              <span class="yt-setting__text"><span class="yt-setting__label">{t("settings.radius")}</span></span>
              <span class="yt-setting__control yt-setting__control--range">
                <input class="yt-range" type="range" name="radius" min="2" max="24" step="1" value={radius()} />
                <output class="yt-range-value" name="radiusValue">{radius()}</output>
              </span>
            </label>
            <SwitchSetting name="motion" checked={current().theme.motion} label={t("settings.motion")} />
            <SettingRow label={t("settings.titlebarStyle")} control={
              <Select name="titlebarStyle" label={() => t("settings.titlebarStyle")} value={() => current().general.titlebarStyle} options={() => [
                { value: "tabs", label: t("settings.titlebarTabs") },
                { value: "icons", label: t("settings.titlebarIcons") },
              ]} onChange={() => queueSave(0)} />
            } />
            <SwitchSetting name="integrateMasthead" checked={current().general.integrateMasthead} label={t("settings.integrateMasthead")} hint={t("settings.integrateMastheadHint")} />
          </section>

          <section id="settings-panel-pip" class="yt-section" role="tabpanel" aria-labelledby="settings-tab-pip" tabIndex={0} hidden={activeTab() !== "pip"}>
            <p class="yt-section__hint">{t("settings.pipHint")}</p>
            <SwitchSetting name="pipEnabled" checked={current().pip.enabled} label={t("settings.pipEnabled")} hint={t("settings.pipEnabledHint")} />
            <SettingRow label={t("settings.pipMode")} hint={t("settings.pipModeHint")} control={
              <Select name="pipMode" label={() => t("settings.pipMode")} value={() => current().pip.mode} options={() => [
                { value: "custom", label: t("settings.pipModeCustom") },
                { value: "native", label: t("settings.pipModeNative") },
              ]} onChange={() => queueSave(0)} />
            } />
            <SwitchSetting name="pipOnMinimize" checked={current().general.pipOnMinimize} label={t("settings.pipMinimize")} hint={t("settings.pipMinimizeHint")} />
            <SwitchSetting name="pipOnBlur" checked={current().general.pipOnBlur} label={t("settings.pipBlur")} hint={t("settings.pipBlurHint")} />
          </section>

          <section id="settings-panel-history" class="yt-section" role="tabpanel" aria-labelledby="settings-tab-history" tabIndex={0} hidden={activeTab() !== "history"}>
            <p class="yt-section__hint">{t("settings.historyHint")}</p>
            <SwitchSetting name="historyEnabled" checked={current().history.enabled} label={t("settings.historyEnabled")} />
            <label class="yt-setting">
              <span class="yt-setting__text"><span class="yt-setting__label">{t("settings.historyMinWatch")}</span></span>
              <span class="yt-setting__control">
                <input class="yt-input yt-input--short" type="number" name="historyMinWatch" min="0" max="600" step="1" value={current().history.minimumWatchSecs} />
              </span>
            </label>
            <SwitchSetting name="historyThumbnails" checked={current().history.keepThumbnails} label={t("settings.historyThumbnails")} />
          </section>

          <section id="settings-panel-app" class="yt-section" role="tabpanel" aria-labelledby="settings-tab-app" tabIndex={0} hidden={activeTab() !== "app"}>
            <p class="yt-section__hint">{t("settings.hardwareAccelerationHint")}</p>
            <SwitchSetting name="hardwareAcceleration" checked={current().general.hardwareAcceleration} label={t("settings.hardwareAcceleration")} />
            <div class="yt-setting">
              <span class="yt-setting__text">
                <span class="yt-setting__label">{t("settings.version")}</span>
                <span class="yt-setting__hint">YT Desktop {props.version}</span>
              </span>
            </div>
          </section>

        </form>
      </div>
    </section>
  );
}

export async function renderSettings(host: HTMLElement, initialTab: string = "appearance"): Promise<void> {
  const [initial, themes, version] = await Promise.all([
    api.settingsGet(),
    api.themeList(),
    api.appVersion(),
  ]);
  const tab = SETTINGS_TABS.includes(initialTab as SettingsTab)
    ? initialTab as SettingsTab
    : "appearance";
  render(() => <SettingsPage initial={initial} themes={themes} version={version} initialTab={tab} />, host);
}
