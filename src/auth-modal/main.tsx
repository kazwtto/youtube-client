import "../styles/tokens.css";
import "../styles/base.css";
import "./auth-modal.css";

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";

import { Icon } from "../components/icons";
import { initI18n, onLanguageChange, t } from "../i18n";
import { initTheme } from "../theme/provider";

interface ModalLayout {
  cardX: number;
  cardY: number;
  cardW: number;
  cardH: number;
  headerH: number;
}

function AuthModal() {
  const [layout, setLayout] = createSignal<ModalLayout>();
  let unlisten: UnlistenFn | undefined;
  let disposed = false;

  const close = (): void => void invoke("close_auth_modal").catch(() => undefined);

  onMount(() => {
    const updateTitle = (): void => { document.title = t("auth.windowTitle"); };
    const stopLanguage = onLanguageChange(updateTitle);
    updateTitle();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    void listen<ModalLayout>("auth://modal-layout", (event) => setLayout(event.payload))
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);

    onCleanup(() => {
      stopLanguage();
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  onCleanup(() => {
    disposed = true;
    unlisten?.();
  });

  return (
    <div class="auth-overlay" onClick={(event) => event.target === event.currentTarget && close()}>
      <div
        class="auth-card"
        style={{
          left: layout() ? `${layout()!.cardX}px` : undefined,
          top: layout() ? `${layout()!.cardY}px` : undefined,
          width: layout() ? `${layout()!.cardW}px` : undefined,
          height: layout() ? `${layout()!.cardH}px` : undefined,
        }}
      >
        <div class="auth-header">
          <div class="auth-header__actions">
            <button type="button" class="auth-btn" title={t("auth.back")} aria-label={t("auth.back")} onClick={() => void invoke("back_auth_modal").catch(() => undefined)}>
              <Icon name="back" size={18} />
            </button>
            <button type="button" class="auth-btn" title={t("auth.reload")} aria-label={t("auth.reload")} onClick={() => void invoke("reload_auth_modal").catch(() => undefined)}>
              <Icon name="reload" size={18} />
            </button>
          </div>
          <div class="auth-header__title">
            <Icon name="account" size={18} />
            <span>{t("auth.heading")}</span>
          </div>
          <button type="button" class="auth-btn auth-btn--close" title={t("auth.close")} aria-label={t("auth.close")} onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div class="auth-content-cutout" />
      </div>
    </div>
  );
}

async function mount(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#auth-modal-root");
  if (!root) return;
  await initI18n();
  await initTheme();
  render(() => <AuthModal />, root);
}

void mount();
