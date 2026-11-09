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
  experimental?: string;
  onChange?: JSX.EventHandlerUnion<HTMLInputElement, Event>;
}

export function ExperimentalBadge(props: { label: string }) {
  return (
    <span class="yt-setting__experimental" role="img" aria-label={props.label} title={props.label}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 3h6m-5 0v6l-5.2 8.3A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.2-3.7L14 9V3m-6.8 12h9.6" />
      </svg>
    </span>
  );
}

export function SwitchSetting(props: SwitchSettingProps) {
  return (
    <label class="yt-setting">
      <span class="yt-setting__text">
        <span class="yt-setting__label-line">
          <span class="yt-setting__label">{props.label}</span>
          {props.experimental && <ExperimentalBadge label={props.experimental} />}
        </span>
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
