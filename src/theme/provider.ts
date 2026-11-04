import { listen } from "@tauri-apps/api/event";

import { t } from "../i18n";
import { api, type ResolvedTheme } from "../lib/api";

/// Applies theme tokens as CSS variables on the document.
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;

  for (const [token, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(token, value);
  }

  root.style.setProperty("color-scheme", theme.effectiveMode);
  root.dataset.theme = theme.effectiveMode;
  root.dataset.backdrop = theme.backdrop;
  root.dataset.motion = theme.motion ? "on" : "off";
}

/// Loads the saved theme and listens for changes emitted by the backend.
export async function initTheme(): Promise<void> {
  try {
    applyTheme(await api.themeGet());
  } catch (error) {
    console.warn(t("theme.loadError", { error: String(error) }));
  }

  await listen<ResolvedTheme>("theme://changed", (event) => {
    applyTheme(event.payload);
  });
}
