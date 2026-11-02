export function renderHome(host: HTMLElement): void {
  // The YouTube webview covers this route. Nothing is rendered here: the
  // loading state lives in the shell and disappears when the site is ready.
  host.replaceChildren();
}
