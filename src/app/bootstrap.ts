import { getCurrentWindow } from "@tauri-apps/api/window";

import { mountTabDock } from "../components/tab-bar";
import { initI18n, t } from "../i18n";
import { initTheme } from "../theme/provider";
import { createShell } from "./shell";

export async function bootstrap(): Promise<void> {
  await initI18n().catch(() => undefined);

  const root = document.querySelector<HTMLElement>("#app");
  if (!root) throw new Error(t("bootstrap.missingRoot"));

  await initTheme().catch(() => undefined);

  if (new URLSearchParams(window.location.search).get("dock") === "1") {
    document.documentElement.dataset.dock = "true";
    mountTabDock(root);
    return;
  }

  createShell(root);
  await getCurrentWindow().show().catch(() => undefined);
}
