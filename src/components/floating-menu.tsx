import { autoUpdate, computePosition, flip, offset, shift, size, type Placement, type VirtualElement } from "@floating-ui/dom";
import { createEffect, createSignal, onCleanup, type Accessor, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

export interface FloatingMenuProps {
  id?: string;
  open: Accessor<boolean>;
  anchor: Accessor<HTMLElement | VirtualElement | undefined>;
  placement?: Placement;
  align?: "start" | "end";
  width?: number;
  class?: string;
  role?: "menu" | "listbox";
  ariaLabel?: string;
  onClose: () => void;
  children: JSX.Element;
}

export function FloatingMenu(props: FloatingMenuProps) {
  const [ready, setReady] = createSignal(false);
  let menuEl!: HTMLDivElement;
  let stopAutoUpdate: (() => void) | undefined;

  const stopPositioning = (): void => {
    stopAutoUpdate?.();
    stopAutoUpdate = undefined;
  };

  const updatePosition = (): Promise<void> => {
    const anchorEl = props.anchor();
    if (!anchorEl || !menuEl) return Promise.resolve();
    const width = props.width ?? 240;
    return computePosition(anchorEl, menuEl, {
      strategy: "fixed",
      placement: props.placement ?? (props.align === "end" ? "bottom-end" : "bottom-start"),
      middleware: [
        offset(6),
        flip({ padding: 8 }),
        shift({ padding: 8 }),
        size({
          padding: 8,
          apply({ availableHeight, availableWidth }) {
            const clampedWidth = Math.min(width, Math.max(160, Math.floor(availableWidth)));
            Object.assign(menuEl.style, {
              width: `${clampedWidth}px`,
              maxWidth: `${Math.floor(availableWidth)}px`,
              maxHeight: `${Math.max(120, Math.floor(availableHeight))}px`,
            });
          },
        }),
      ],
    }).then(({ x, y, placement }) => {
      if (!menuEl) return;
      menuEl.classList.toggle("is-above", placement.startsWith("top"));
      Object.assign(menuEl.style, {
        left: `${Math.round(x)}px`,
        top: `${Math.round(y)}px`,
      });
    });
  };

  createEffect(() => {
    const isOpen = props.open();
    const anchorEl = props.anchor();
    if (isOpen && anchorEl && menuEl) {
      void updatePosition().then(() => {
        if (props.open()) setReady(true);
      });
      if (!stopAutoUpdate) {
        stopAutoUpdate = autoUpdate(anchorEl, menuEl, () => void updatePosition());
      }
    } else {
      setReady(false);
      stopPositioning();
    }
  });

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (!props.open()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    const anchorEl = props.anchor();
    if ((anchorEl instanceof Node && anchorEl.contains(target)) || menuEl?.contains(target)) return;
    props.onClose();
  };

  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (props.open() && event.key === "Escape") {
      event.stopPropagation();
      props.onClose();
    }
  };

  const onWindowBlur = (): void => {
    if (props.open()) props.onClose();
  };

  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeyDown);
  window.addEventListener("blur", onWindowBlur);

  onCleanup(() => {
    stopPositioning();
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown);
    window.removeEventListener("blur", onWindowBlur);
  });

  return (
    <Portal>
      <div
        id={props.id}
        class={`yt-menu ${props.align === "end" ? "yt-menu--end" : ""} ${props.class ?? ""}`.trim()}
        classList={{ "is-open": props.open() && ready() }}
        role={props.role ?? "menu"}
        aria-label={props.ariaLabel}
        aria-hidden={!props.open()}
        inert={!props.open()}
        ref={menuEl}
      >
        {props.children}
      </div>
    </Portal>
  );
}
