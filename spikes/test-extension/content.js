(() => {
  "use strict";

  const MARKER_ID = "yt-desktop-test-extension";
  const install = () => {
    const root = document.documentElement;
    if (!root) return false;
    if (document.getElementById(MARKER_ID)) return true;

    const badge = document.createElement("div");
    badge.id = MARKER_ID;
    badge.textContent = "YT Desktop test extension loaded";
    badge.style.cssText = [
      "position: fixed",
      "right: 16px",
      "bottom: 16px",
      "z-index: 2147483647",
      "padding: 8px 12px",
      "border-radius: 8px",
      "background: #0a84ff",
      "color: #ffffff",
      "font: 600 12px/1.4 'Segoe UI', sans-serif",
      "box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25)",
      "pointer-events: none",
    ].join(";");

    root.append(badge);
    console.info("[YT Desktop] test extension active");
    return true;
  };

  if (!install()) {
    const observer = new MutationObserver(() => {
      if (install()) observer.disconnect();
    });
    observer.observe(document, { childList: true });
  }
})();
