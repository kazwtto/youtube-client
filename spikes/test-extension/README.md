# WebView2 test extension

Minimal Manifest V3 extension used to validate that YT Desktop loads unpacked
Chromium extensions through `browser_extensions_enabled(true)` and the WebView2
profile.

## Install

1. Open YT Desktop.
2. Go to **Extensions**.
3. Install this folder by absolute path: `spikes/test-extension`.
4. The YouTube webview reloads automatically once the profile changes.

## Expected result

The extension injects a small badge in the bottom-right corner of
`youtube.com` with the text **YT Desktop test extension loaded**. The DevTools
console also prints `[YT Desktop] test extension active`.

The badge is intentionally visible so the check does not depend on DevTools.