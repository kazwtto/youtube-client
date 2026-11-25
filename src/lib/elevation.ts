import { api } from "./api";

const activeSources = new Set<string>();
let currentElevated = false;

/** Coordinates shared UI webview elevation across independent UI components. */
export function setUiElevationSource(source: string, elevated: boolean): void {
  if (elevated) {
    activeSources.add(source);
  } else {
    activeSources.delete(source);
  }
  const next = activeSources.size > 0;
  if (next === currentElevated) return;
  currentElevated = next;
  void api.setUiElevation(next).catch(() => undefined);
}
