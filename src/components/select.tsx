import { For, Show, createEffect, createMemo, createSignal, onCleanup, createUniqueId } from "solid-js";
import { Portal } from "solid-js/web";
import type { Accessor } from "solid-js";

import { Icon } from "./icons";
import { ExperimentalBadge } from "./setting-row";

export interface SelectOption {
  value: string;
  label: string;
  experimental?: string;
}

interface SelectProps {
  name: string;
  label: Accessor<string>;
  value: Accessor<string>;
  options: Accessor<readonly SelectOption[]>;
  onChange: (value: string) => void;
}

/// Replaces the look of a native `<select>` with a YouTube-style control while
/// keeping the native element as the source of truth, so existing form code
/// keeps working unchanged.
export function Select(props: SelectProps) {
  const [open, setOpen] = createSignal(false);
  const [openAbove, setOpenAbove] = createSignal(false);
  const [selected, setSelected] = createSignal(props.value());
  const [position, setPosition] = createSignal({ top: 0, left: 12, width: 200, maxHeight: 280 });
  const menuId = createUniqueId();
  const selectedLabel = createMemo(
    () => props.options().find((option) => option.value === selected())?.label ?? "",
  );
  const selectedExperimental = createMemo(
    () => props.options().find((option) => option.value === selected())?.experimental,
  );
  let wrapper!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  let menu!: HTMLDivElement;
  let nativeSelect!: HTMLSelectElement;

  /// Copies the current native value into the visible control.
  const syncFromNative = (): void => {
    setSelected(nativeSelect.value);
  };
  createEffect(() => {
    nativeSelect.value = props.value();
    syncFromNative();
  });

  const close = (): void => {
    setOpen(false);
  };
  const positionMenu = (): void => {
    const bounds = trigger.getBoundingClientRect();
    const gutter = Math.min(12, window.innerWidth / 2, window.innerHeight / 2);
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const width = Math.min(Math.max(bounds.width, 200), Math.max(1, viewportWidth - gutter * 2));
    const naturalHeight = Math.min(props.options().length * 40 + 14, viewportHeight - gutter * 2);
    const below = Math.max(0, viewportHeight - bounds.bottom - gutter);
    const above = Math.max(0, bounds.top - gutter);
    const placeAbove = below < naturalHeight && above > below;
    const available = placeAbove ? above : below;
    const maxHeight = Math.min(viewportHeight - gutter * 2, Math.max(64, Math.min(naturalHeight, available)));
    const unclampedTop = placeAbove ? bounds.top - maxHeight - 4 : bounds.bottom + 4;
    setOpenAbove(placeAbove);
    setPosition({
      left: Math.max(gutter, Math.min(bounds.left, viewportWidth - width - gutter)),
      top: Math.max(gutter, Math.min(unclampedTop, viewportHeight - gutter - maxHeight)),
      width,
      maxHeight,
    });
  };
  const openMenu = (): void => {
    positionMenu();
    setOpen(true);
    requestAnimationFrame(() => {
      menu
        .querySelector<HTMLButtonElement>('[aria-selected="true"]')
        ?.focus();
    });
  };

  const handlePointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof Node && !wrapper.contains(target) && !menu?.contains(target)) close();
  };
  document.addEventListener("pointerdown", handlePointerDown);
  const handleViewportChange = (): void => {
    if (open()) positionMenu();
  };
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);
  onCleanup(() => {
    document.removeEventListener("pointerdown", handlePointerDown);
    window.removeEventListener("resize", handleViewportChange);
    window.removeEventListener("scroll", handleViewportChange, true);
  });

  const moveFocus = (event: KeyboardEvent): void => {
    const options = [...menu.querySelectorAll<HTMLButtonElement>("[role=option]")];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown"
      ? Math.min(options.length - 1, index + 1)
      : Math.max(0, index - 1);
    event.preventDefault();
    options[next]?.focus();
  };

  return (
    <>
      <select
        class="yt-select yt-select--native"
        name={props.name}
        value={selected()}
        aria-hidden="true"
        tabIndex={-1}
        ref={nativeSelect}
      >
        <For each={props.options()}>
          {(option) => <option value={option.value}>{option.label}</option>}
        </For>
      </select>
      <div class="yt-dropdown" ref={wrapper}>
        <button
          type="button"
          class="yt-dropdown__button"
          aria-label={props.label()}
          aria-haspopup="listbox"
          aria-expanded={open()}
          aria-controls={menuId}
          onClick={() => open() ? close() : openMenu()}
          onKeyDown={(event) => {
            if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
              event.preventDefault();
              openMenu();
            }
          }}
          ref={trigger}
        >
          <span class="yt-dropdown__value"><span>{selectedLabel()}</span><Show when={selectedExperimental()}>{(label) => <ExperimentalBadge label={label()} />}</Show></span>
          <Icon name="chevron" size={18} />
        </button>
      </div>
      <Portal>
        <div
          class="yt-dropdown__menu"
          classList={{ "is-open": open(), "is-above": openAbove() }}
          id={menuId}
          role="listbox"
          aria-label={props.label()}
          aria-hidden={!open()}
          inert={!open()}
          style={{ top: `${position().top}px`, left: `${position().left}px`, width: `${position().width}px`, "max-height": `${position().maxHeight}px` }}
          ref={menu}
          onFocusOut={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || (!wrapper.contains(next) && !menu.contains(next))) close();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              moveFocus(event);
            } else if (event.key === "Escape") {
              event.preventDefault();
              close();
              trigger.focus();
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              const options = menu.querySelectorAll<HTMLButtonElement>("[role=option]");
              (event.key === "Home" ? options[0] : options[options.length - 1])?.focus();
            }
          }}
        >
          <For each={props.options()}>
            {(option) => (
              <button
                type="button"
                class="yt-dropdown__option"
                classList={{ "is-selected": selected() === option.value }}
                role="option"
                aria-selected={selected() === option.value}
                tabIndex={-1}
                onClick={() => {
                  nativeSelect.value = option.value;
                  syncFromNative();
                  props.onChange(nativeSelect.value);
                  close();
                  trigger.focus();
                }}
              >
                <span class="yt-dropdown__option-label"><span>{option.label}</span>{option.experimental && <ExperimentalBadge label={option.experimental} />}</span>
                <span class="yt-dropdown__check" aria-hidden="true">
                  <Icon name="check" size={16} />
                </span>
              </button>
            )}
          </For>
        </div>
      </Portal>
    </>
  );
}
