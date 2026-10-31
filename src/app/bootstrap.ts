import { initI18n, t } from "../i18n";
import { initTheme } from "../theme/provider";
import { createShell } from "./shell";

export async function bootstrap(): Promise<void> {
  await initI18n();

  const root = document.querySelector<HTMLElement>("#app");
  if (!root) {
    throw new Error(t("bootstrap.missingRoot"));
  }

  await initTheme();
  createShell(root);
}