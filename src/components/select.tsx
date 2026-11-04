import { For, createEffect, createMemo, createSignal, onCleanup, createUniqueId } from "solid-js";
import type { Accessor } from "solid-js";

import { Icon } from "./icons";

export interface SelectOption {
  value: string;
  label: string;
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
  const [selected, setSelected] = createSignal(props.value());
  const menuId = createUniqueId();
  const selectedLabel = createMemo(
    () => props.options().find((option) => option.value === selected())?.label ?? "",
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

  const close = (): void => { setOpen(false); };
  const openMenu = (): void => {
    setOpen(true);
    requestAnimationFrame(() => {
      menu
        .querySelector<HTMLButtonElement>('[aria-selected="true"]')
        ?.focus();
    });
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (!wrapper.contains(event.target as Node)) close();
  };
  document.addEventListener("pointerdown", handlePointerDown);
  onCleanup(() => document.removeEventListener("pointerdown", handlePointerDown));

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
          <span class="yt-dropdown__value">{selectedLabel()}</span>
          <Icon name="chevron" size={18} />
        </button>
        <div
          class="yt-dropdown__menu"
          id={menuId}
          role="listbox"
          aria-label={props.label()}
          hidden={!open()}
          ref={menu}
          onFocusOut={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !wrapper.contains(next)) close();
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
                <span class="yt-dropdown__option-label">{option.label}</span>
                <span class="yt-dropdown__check" aria-hidden="true">
                  <Icon name="check" size={16} />
                </span>
              </button>
            )}
          </For>
        </div>
      </div>
    </>
  );
}
