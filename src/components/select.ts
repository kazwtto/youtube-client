import { icon } from "./icons";

export interface SelectEnhancer {
  /// Copies the current native value into the visible control.
  sync: () => void;
}

/// Replaces the look of a native `<select>` with a YouTube-style control while
/// keeping the native element as the source of truth, so existing form code
/// keeps working unchanged.
export function enhanceSelect(select: HTMLSelectElement): SelectEnhancer {
  const wrapper = document.createElement("div");
  wrapper.className = "yt-dropdown";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "yt-dropdown__button";
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `<span class="yt-dropdown__value"></span>${icon("chevron", 18)}`;

  const menu = document.createElement("div");
  menu.className = "yt-dropdown__menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;

  const valueLabel = button.querySelector<HTMLElement>(".yt-dropdown__value")!;

  const options = [...select.options].map((option) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "yt-dropdown__option";
    item.dataset.value = option.value;
    item.setAttribute("role", "option");
    item.innerHTML = `<span class="yt-dropdown__option-label"></span><span class="yt-dropdown__check">${icon("check", 16)}</span>`;
    item.querySelector<HTMLElement>(".yt-dropdown__option-label")!.textContent = option.label;

    item.addEventListener("click", () => {
      choose(option.value);
    });

    menu.append(item);
    return item;
  });

  select.classList.add("yt-select--native");
  select.after(wrapper);
  wrapper.append(button, menu);

  function sync(): void {
    const selected = select.selectedOptions[0];

    if (selected) {
      valueLabel.textContent = selected.label;

      for (const item of options) {
        const active = item.dataset.value === selected.value;
        item.classList.toggle("is-selected", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      }
    }
  }

  function close(): void {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function open(): void {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const selected = menu.querySelector<HTMLElement>(".is-selected");
    selected?.focus();
  }

  function choose(value: string): void {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    sync();
    close();
    button.focus();
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.hidden) {
      open();
    } else {
      close();
    }
  });

  button.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });

  menu.addEventListener("keydown", (event) => {
    const items = options;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[Math.min(items.length - 1, index + 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[Math.max(0, index - 1)]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      button.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target as Node)) {
      close();
    }
  });

  sync();

  return { sync };
}
