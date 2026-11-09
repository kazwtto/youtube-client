import type { IconName } from "../components/icons";
import type { TranslationKey } from "../i18n";
import type { RouteId } from "./router";

export interface AppSection {
  id: RouteId;
  labelKey: TranslationKey;
  icon: IconName;
}

export const APP_SECTIONS: readonly AppSection[] = [
  { id: "home", labelKey: "nav.watch", icon: "home" },
  { id: "history", labelKey: "nav.history", icon: "history" },
  { id: "extensions", labelKey: "nav.extensions", icon: "extensions" },
  { id: "rpc", labelKey: "nav.discord", icon: "discord" },
  { id: "settings", labelKey: "nav.settings", icon: "settings" },
];
