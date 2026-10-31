import type { RouteDefinition, RouteId } from "../app/router";
import { t } from "../i18n";

export function renderSidebar(
  host: HTMLElement,
  routes: RouteDefinition[],
  current: RouteId,
  onSelect: (id: RouteId) => void,
): void {
  host.replaceChildren();

  const nav = document.createElement("nav");
  nav.className = "sidebar__nav";
  nav.setAttribute("aria-label", t("sidebar.navigation"));

  for (const route of routes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sidebar__item";

    if (route.id === current) {
      button.classList.add("sidebar__item--active");
      button.setAttribute("aria-current", "page");
    }

    const icon = document.createElement("span");
    icon.className = "sidebar__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = route.icon;

    const label = document.createElement("span");
    label.textContent = route.label;

    button.append(icon, label);
    button.addEventListener("click", () => onSelect(route.id));
    nav.append(button);
  }

  host.append(nav);
}