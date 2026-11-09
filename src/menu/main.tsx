import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/components.css";
import "./menu.css";

import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";

import { Icon, type IconName, type YoutubeIconName } from "../components/icons";
import { initI18n, onLanguageChange, t, type TranslationKey } from "../i18n";
import type { AuthSnapshot } from "../lib/api";
import { initTheme } from "../theme/provider";
import { APP_SECTIONS } from "../app/navigation";

interface MenuData {
  auth: AuthSnapshot;
  mode: "account" | "sections";
  activeRoute?: string;
}

const ACCOUNT_ITEMS: Array<[string, TranslationKey, YoutubeIconName | IconName]> = [
  ["channel", "menu.channel", "account"],
  ["studio", "menu.studio", "studio"],
  ["switch-account", "menu.switchAccount", "switch-account"],
  ["logout", "menu.signOut", "logout"],
  ["purchases", "menu.purchases", "purchases"],
  ["your-data", "menu.yourData", "your-data"],
  ["shortcuts", "menu.shortcuts", "shortcuts"],
  ["settings-app", "menu.appSettings", "settings"],
];

function MenuItem(props: { action: string; label: TranslationKey; icon: YoutubeIconName | IconName; highlight?: boolean; selected?: boolean; onSelect: (action: string) => void }) {
  return (
    <button
      type="button"
      class="yt-context-menu__item"
      classList={{
        "yt-context-menu__item--highlight": props.highlight === true,
        "yt-context-menu__item--selected": props.selected === true,
      }}
      role={props.selected === undefined ? undefined : "menuitemradio"}
      aria-checked={props.selected}
      aria-current={props.selected ? "page" : undefined}
      onClick={() => props.onSelect(props.action)}
    >
      <Icon name={props.icon} size={20} />
      <span>{t(props.label)}</span>
      <Show when={props.selected}><Icon name="check" size={16} class="yt-context-menu__item-check" /></Show>
    </button>
  );
}

function MenuView() {
  // Render initial fallback state
  const [auth, setAuth] = createSignal<AuthSnapshot>({ loggedIn: false });
  const [mode, setMode] = createSignal<MenuData["mode"]>("account");
  const [activeRoute, setActiveRoute] = createSignal("home");
  const [avatarFailed, setAvatarFailed] = createSignal(false);
  let host!: HTMLDivElement;
  let avatarImage!: HTMLImageElement;
  let unlisten: UnlistenFn | undefined;
  let disposed = false;

  const closeMenu = (): void => void invoke("hide_context_menu").catch(() => undefined);
  const handleAction = (action: string): void => {
    closeMenu();
    if (action === "login") {
      void invoke("open_auth_modal").catch(() => undefined);
    } else {
      void emit("menu-action", { action }).catch(() => undefined);
    }
  };

  let previousAuth = auth();
  createEffect(() => {
    const snapshot = auth();
    if (snapshot !== previousAuth) {
      previousAuth = snapshot;
      setAvatarFailed(false);
      if (snapshot.avatarUrl && avatarImage) avatarImage.src = snapshot.avatarUrl;
    }
    requestAnimationFrame(() => {
      const height = host.offsetHeight;
      if (height > 0) void getCurrentWindow().setSize(new LogicalSize(host.offsetWidth + 48, height + 44)).catch(() => undefined);
    });
  });

  onMount(() => {
    const stopLanguage = onLanguageChange(() => {
      document.title = t("menu.title");
    });
    document.title = t("menu.title");

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeMenu();
    };
    const onBlur = (): void => closeMenu();
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest(".yt-context-menu")) closeMenu();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    document.addEventListener("pointerdown", onPointerDown);

    void listen<MenuData>("menu://data", (event) => {
      if (!event.payload) return;
      setAuth(event.payload.auth);
      setMode(event.payload.mode ?? "account");
      setActiveRoute(event.payload.activeRoute ?? "home");
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => undefined);

    onCleanup(() => {
      stopLanguage();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("pointerdown", onPointerDown);
    });
  });

  onCleanup(() => {
    disposed = true;
    unlisten?.();
  });

  return (
    <div class="yt-context-menu" ref={host}>
      <Show
        when={mode() === "sections"}
        fallback={
          <Show when={auth().loggedIn} fallback={
            <div class="yt-context-menu__body">
              <MenuItem action="login" label="menu.signIn" icon="account" highlight onSelect={handleAction} />
              <MenuItem action="your-data" label="menu.yourData" icon="your-data" onSelect={handleAction} />
              <div class="yt-context-menu__divider" />
              <MenuItem action="shortcuts" label="menu.shortcuts" icon="shortcuts" onSelect={handleAction} />
              <MenuItem action="settings-app" label="menu.appSettings" icon="settings" onSelect={handleAction} />
              <MenuItem action="help" label="menu.help" icon="help" onSelect={handleAction} />
            </div>
          }>
            <>
              <div class="yt-context-menu__header">
                <div class="yt-context-menu__avatar-container">
                  <Show when={auth().avatarUrl}>
                    <img
                      class="yt-context-menu__header-avatar"
                      src={auth().avatarUrl!}
                      referrerpolicy="no-referrer"
                      alt=""
                      ref={avatarImage}
                      style={{ display: avatarFailed() ? "none" : "block" }}
                      onError={() => setAvatarFailed(true)}
                    />
                  </Show>
                  <span
                    class="yt-context-menu__header-avatar--fallback"
                    style={{ display: auth().avatarUrl && !avatarFailed() ? "none" : "flex" }}
                  >
                    <Icon name="account" size={24} />
                  </span>
                </div>
                <div class="yt-context-menu__header-info">
                  <span class="yt-context-menu__header-name">{auth().displayName || auth().handle || t("menu.myAccount")}</span>
                  <Show when={auth().handle}><span class="yt-context-menu__header-handle">{auth().handle}</span></Show>
                </div>
              </div>
              <div class="yt-context-menu__body">
                <For each={ACCOUNT_ITEMS.slice(0, 4)}>{([action, label, icon]) => <MenuItem action={action} label={label} icon={icon} onSelect={handleAction} />}</For>
                <div class="yt-context-menu__divider" />
                <For each={ACCOUNT_ITEMS.slice(4, 6)}>{([action, label, icon]) => <MenuItem action={action} label={label} icon={icon} onSelect={handleAction} />}</For>
                <div class="yt-context-menu__divider" />
                <For each={ACCOUNT_ITEMS.slice(6)}>{([action, label, icon]) => <MenuItem action={action} label={label} icon={icon} onSelect={handleAction} />}</For>
              </div>
            </>
          </Show>
        }
      >
        <div class="yt-context-menu__body" role="menu" aria-label={t("titlebar.appActions")}>
            <For each={APP_SECTIONS}>{({ id: route, labelKey, icon }) => (
              <MenuItem
                action={`section:${route}`}
                label={labelKey}
                icon={icon}
                selected={activeRoute() === route}
                onSelect={handleAction}
              />
            )}</For>
        </div>
      </Show>
    </div>
  );
}

async function mount(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#menu-root");
  if (!root) return;
  await initI18n();
  await initTheme();
  render(() => <MenuView />, root);
}

void mount();
