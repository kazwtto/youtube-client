import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/components.css";
import "./menu.css";

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

import { icon, ytIcon } from "../components/icons";
import type { AuthSnapshot } from "../lib/api";

function mount(): void {
  const root = document.querySelector<HTMLElement>("#menu-root");
  if (!root) {
    return;
  }

  const close = (): void => {
    void invoke("hide_context_menu").catch(() => undefined);
  };

  const handleAction = (action: string): void => {
    if (action === "login") {
      close();
      void invoke("open_auth_modal").catch(() => undefined);
      return;
    }
    close();
    void emit("menu-action", { action }).catch(() => undefined);
  };

  const render = (auth: AuthSnapshot): void => {
    if (auth.loggedIn) {
      root.innerHTML = `
        <div class="yt-context-menu">
          <div class="yt-context-menu__header">
            <div class="yt-context-menu__avatar-container">
              ${auth.avatarUrl ? `<img class="yt-context-menu__header-avatar" src="${auth.avatarUrl}" alt="" onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex';" />` : ""}
              <span class="yt-context-menu__header-avatar--fallback" ${auth.avatarUrl ? 'style="display:none"' : ""}>
                ${ytIcon("account", 24)}
              </span>
            </div>
            <div class="yt-context-menu__header-info">
              <span class="yt-context-menu__header-name">${auth.displayName || auth.handle || ""}</span>
              ${auth.handle ? `<span class="yt-context-menu__header-handle">${auth.handle}</span>` : ""}
            </div>
          </div>
          <div class="yt-context-menu__body">
            <button type="button" class="yt-context-menu__item" data-menu-action="channel">
              ${ytIcon("account", 20)}
              <span>Seu canal</span>
            </button>
            <button type="button" class="yt-context-menu__item" data-menu-action="studio">
              ${ytIcon("studio", 20)}
              <span>YouTube Studio</span>
            </button>
            <button type="button" class="yt-context-menu__item" data-menu-action="switch-account">
              ${ytIcon("switch-account", 20)}
              <span>Alternar conta</span>
            </button>
            <button type="button" class="yt-context-menu__item" data-menu-action="logout">
              ${ytIcon("logout", 20)}
              <span>Sair</span>
            </button>
            <div class="yt-context-menu__divider"></div>
            <button type="button" class="yt-context-menu__item" data-menu-action="purchases">
              ${ytIcon("purchases", 20)}
              <span>Compras e assinaturas</span>
            </button>
            <button type="button" class="yt-context-menu__item" data-menu-action="your-data">
              ${ytIcon("your-data", 20)}
              <span>Seus dados no YouTube</span>
            </button>
            <div class="yt-context-menu__divider"></div>
            <button type="button" class="yt-context-menu__item" data-menu-action="shortcuts">
              ${ytIcon("shortcuts", 20)}
              <span>Teclas de atalho</span>
            </button>
            <button type="button" class="yt-context-menu__item" data-menu-action="settings-app">
              ${icon("settings", 20)}
              <span>Ajustes do aplicativo</span>
            </button>
          </div>
        </div>
      `;
    } else {
      root.innerHTML = `
        <div class="yt-context-menu">
          <div class="yt-context-menu__body">
            <button type="button" class="yt-context-menu__item yt-context-menu__item--highlight" data-menu-action="login">
              ${ytIcon("account", 20)}
              <span>Fazer login</span>
            </button>
            <button type="button" class="yt-context-menu__item" data-menu-action="your-data">
              ${ytIcon("your-data", 20)}
              <span>Seus dados no YouTube</span>
            </button>
            <div class="yt-context-menu__divider"></div>
            <button type="button" class="yt-context-menu__item" data-menu-action="shortcuts">
              ${ytIcon("shortcuts", 20)}
              <span>Teclas de atalho</span>
            </button>
            <button type="button" class="yt-context-menu__item" data-menu-action="settings-app">
              ${icon("settings", 20)}
              <span>Ajustes do aplicativo</span>
            </button>
            <button type="button" class="yt-context-menu__item" data-menu-action="help">
              ${ytIcon("help", 20)}
              <span>Ajuda e feedback</span>
            </button>
          </div>
        </div>
      `;
    }

    requestAnimationFrame(() => {
      const menu = root.querySelector<HTMLElement>(".yt-context-menu");
      if (menu) {
        const h = menu.offsetHeight;
        const w = menu.offsetWidth || 260;
        if (h > 0) {
          const winW = w + 48;
          const winH = h + 44;
          void getCurrentWindow().setSize(new LogicalSize(winW, winH));
        }
      }
    });
  };

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest<HTMLButtonElement>("[data-menu-action]");
    if (btn?.dataset.menuAction) {
      handleAction(btn.dataset.menuAction);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
    }
  });

  window.addEventListener("blur", () => {
    close();
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest(".yt-context-menu")) {
      close();
    }
  });

  void listen<AuthSnapshot>("menu://data", (event) => {
    if (event.payload) {
      render(event.payload);
    }
  }).catch(() => undefined);

  // Render initial fallback state
  render({ loggedIn: false });
}

mount();

