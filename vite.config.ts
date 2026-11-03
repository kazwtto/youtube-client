import { resolve } from "node:path";

import { defineConfig } from "vite";

// Fixed port to match `devUrl` in tauri.conf.json.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        pip: resolve(__dirname, "pip.html"),
        menu: resolve(__dirname, "menu.html"),
        authModal: resolve(__dirname, "auth-modal.html"),
      },
    },
  },
});
