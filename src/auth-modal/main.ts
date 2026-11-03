import "../styles/tokens.css";
import "../styles/base.css";
import "./auth-modal.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { icon, ytIcon } from "../components/icons";

interface ModalLayout {
  cardX: number;
  cardY: number;
  cardW: number;
  cardH: number;
  headerH: number;
}

function mount(): void {
  const root = document.querySelector<HTMLElement>("#auth-modal-root");
  if (!root) {
    return;
  }

  root.innerHTML = `
    <div class="auth-overlay" id="auth-overlay">
      <div class="auth-card" id="auth-card">
        <div class="auth-header" id="auth-header">
          <div class="auth-header__actions">
            <button type="button" class="auth-btn" id="auth-btn-back" title="Voltar">
              ${icon("back", 18)}
            </button>
            <button type="button" class="auth-btn" id="auth-btn-reload" title="Recarregar">
              ${icon("reload", 18)}
            </button>
          </div>
          <div class="auth-header__title">
            ${ytIcon("account", 18)}
            <span>Fazer login no Google</span>
          </div>
          <button type="button" class="auth-btn auth-btn--close" id="auth-btn-close" title="Fechar">
            ${icon("close", 18)}
          </button>
        </div>
        <div class="auth-content-cutout"></div>
      </div>
    </div>
  `;

  const overlay = document.getElementById("auth-overlay");
  const card = document.getElementById("auth-card");
  const btnClose = document.getElementById("auth-btn-close");
  const btnReload = document.getElementById("auth-btn-reload");
  const btnBack = document.getElementById("auth-btn-back");

  const close = (): void => {
    void invoke("close_auth_modal").catch(() => undefined);
  };

  const reload = (): void => {
    void invoke("reload_auth_modal").catch(() => undefined);
  };

  const back = (): void => {
    void invoke("back_auth_modal").catch(() => undefined);
  };

  btnClose?.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });

  btnReload?.addEventListener("click", (e) => {
    e.stopPropagation();
    reload();
  });

  btnBack?.addEventListener("click", (e) => {
    e.stopPropagation();
    back();
  });

  overlay?.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
    }
  });

  void listen<ModalLayout>("auth://modal-layout", (event) => {
    const layout = event.payload;
    if (card && layout) {
      card.style.left = `${layout.cardX}px`;
      card.style.top = `${layout.cardY}px`;
      card.style.width = `${layout.cardW}px`;
      card.style.height = `${layout.cardH}px`;
    }
  });
}

mount();
