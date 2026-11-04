import type { JSX } from "solid-js";

interface SettingRowProps {
  label: string;
  hint?: string;
  control: JSX.Element;
}

export function SettingRow(props: SettingRowProps) {
  return (
    <div class="yt-setting">
      <span class="yt-setting__text">
        <span class="yt-setting__label">{props.label}</span>
        {props.hint && <span class="yt-setting__hint">{props.hint}</span>}
      </span>
      {props.control}
    </div>
  );
}

interface SwitchSettingProps {
  name?: string;
  checked: boolean;
  label: string;
  hint?: string;
  onChange?: JSX.EventHandlerUnion<HTMLInputElement, Event>;
}

export function SwitchSetting(props: SwitchSettingProps) {
  return (
    <label class="yt-setting">
      <span class="yt-setting__text">
        <span class="yt-setting__label">{props.label}</span>
        {props.hint && <span class="yt-setting__hint">{props.hint}</span>}
      </span>
      <span class="yt-switch">
        <input
          type="checkbox"
          role="switch"
          name={props.name}
          checked={props.checked}
          onChange={props.onChange}
        />
        <span class="yt-switch__track" aria-hidden="true" />
      </span>
    </label>
  );
}
