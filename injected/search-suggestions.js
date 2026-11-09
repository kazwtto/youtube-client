/* Disabled native YouTube suggestion bridge attempt. The restored titlebar
 * implementation uses custom suggestions; this earlier attempt is kept here
 * as a comment for reference.
 *
// Keep the search field in the launcher. Only expose the site's own suggestion
// popup in the YouTube WebView, immediately below the launcher title bar.
(() => {
  if (window.__ytdesktopSearchSuggestions) return;

  const root = document.documentElement;
  const popupSelector = ".ytSearchboxComponentSuggestionsContainer, .gstl_50";
  const inputSelector = "input[name=search_query], textarea[name=search_query], input#search, .ytSearchboxComponentInput, .ytSearchboxComponentInputTextArea";
  const style = document.createElement("style");
  style.textContent = `
    html[data-ytdesktop-suggestions] #masthead-container,
    html[data-ytdesktop-suggestions] ytd-masthead {
      display: block !important;
      position: fixed !important;
      inset: 0 0 auto !important;
      height: 56px !important;
      min-height: 56px !important;
      max-height: none !important;
      overflow: visible !important;
      visibility: hidden !important;
      pointer-events: none !important;
      z-index: 2200 !important;
    }
    html[data-ytdesktop-suggestions] :is(${popupSelector}) {
      position: fixed !important;
      inset: 0 auto auto var(--ytdesktop-suggestion-left) !important;
      width: var(--ytdesktop-suggestion-width) !important;
      visibility: visible !important;
      pointer-events: auto !important;
      z-index: 2201 !important;
    }
  `;
  document.head.append(style);

  let input;
  let timer;

  function findInput() {
    const masthead = document.querySelector("ytd-masthead");
    if (!masthead) return null;
    const roots = [masthead];
    for (const node of roots) {
      const field = node.querySelector(inputSelector);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return field;
      if (node.shadowRoot) roots.push(node.shadowRoot);
      for (const child of node.querySelectorAll("*")) {
        if (child.shadowRoot) roots.push(child.shadowRoot);
      }
    }
    return null;
  }

  function close() {
    clearTimeout(timer);
    root.removeAttribute("data-ytdesktop-suggestions");
    if (!input) return;
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
    input.dispatchEvent(new FocusEvent("blur"));
    input = undefined;
  }

  function update(query, left, width, attempt = 0) {
    clearTimeout(timer);
    if (!width) {
      close();
      return;
    }
    // Give the site's search box layout before looking for its input. The
    // integrated masthead normally has display:none, including during mount.
    root.style.setProperty("--ytdesktop-suggestion-left", left + "px");
    root.style.setProperty("--ytdesktop-suggestion-width", width + "px");
    root.setAttribute("data-ytdesktop-suggestions", "");
    const field = findInput();
    if (!field) {
      if (attempt < 10) timer = setTimeout(() => update(query, left, width, attempt + 1), 150);
      else close();
      return;
    }

    if (field !== input) {
      input = field;
      field.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
      field.dispatchEvent(new FocusEvent("focus"));
    }
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(field, query);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText" }));
  }

  document.addEventListener("pointerdown", (event) => {
    if (!event.composedPath().some((node) => node instanceof Element && node.matches(popupSelector))) close();
  }, true);
  window.addEventListener("yt-navigate-start", close);
  window.__ytdesktopSearchSuggestions = { update, close };
})();
*/
