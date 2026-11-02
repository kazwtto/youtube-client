import { listen } from "@tauri-apps/api/event";

import { t } from "../i18n";
import { api, type AppSettings, type RpcStatus } from "../lib/api";

function hintFor(status: RpcStatus): string {
  if (status.state === "disabled") {
    return t("rpc.disabledHint");
  }

  if (status.state === "connected") {
    return t("rpc.connectedHint");
  }

  return status.detail ?? t("rpc.noDetail");
}

export async function renderRpc(host: HTMLElement): Promise<void> {
  const [status, settings] = await Promise.all([api.rpcStatus(), api.settingsGet()]);
  let current = settings;

  host.innerHTML = `
    <section class="page page--discord">
      <header class="page__header">
        <h1>${t("rpc.title")}</h1>
        <p class="page__lead">${t("rpc.lead")}</p>
      </header>

      <section class="yt-section">
        <h2 class="yt-section__title">${t("rpc.section")}</h2>

        <label class="yt-setting">
          <span class="yt-setting__text">
            <span class="yt-setting__label">${t("rpc.enabled")}</span>
            <span class="yt-setting__hint">${t("rpc.enabledHint")}</span>
          </span>
          <span class="yt-switch">
            <input type="checkbox" role="switch" name="rpcEnabled" />
            <span class="yt-switch__track" aria-hidden="true"></span>
          </span>
        </label>

        <p class="rpc-problem" id="rpc-problem" role="status" aria-live="polite" hidden></p>
      </section>

      <section class="yt-section">
        <h2 class="yt-section__title">${t("rpc.displayTitle")}</h2>

        <label class="yt-setting">
          <span class="yt-setting__text">
            <span class="yt-setting__label">${t("rpc.timestamps")}</span>
          </span>
          <span class="yt-switch">
            <input type="checkbox" role="switch" name="rpcTimestamps" />
            <span class="yt-switch__track" aria-hidden="true"></span>
          </span>
        </label>

        <label class="yt-setting">
          <span class="yt-setting__text">
            <span class="yt-setting__label">${t("rpc.videoButton")}</span>
          </span>
          <span class="yt-switch">
            <input type="checkbox" role="switch" name="rpcVideoButton" />
            <span class="yt-switch__track" aria-hidden="true"></span>
          </span>
        </label>

        <label class="yt-setting">
          <span class="yt-setting__text">
            <span class="yt-setting__label">${t("rpc.channelButton")}</span>
          </span>
          <span class="yt-switch">
            <input type="checkbox" role="switch" name="rpcChannelButton" />
            <span class="yt-switch__track" aria-hidden="true"></span>
          </span>
        </label>

        <label class="yt-setting">
          <span class="yt-setting__text">
            <span class="yt-setting__label">${t("rpc.idle")}</span>
            <span class="yt-setting__hint">${t("rpc.idleHint")}</span>
          </span>
          <span class="yt-switch">
            <input type="checkbox" role="switch" name="rpcIdle" />
            <span class="yt-switch__track" aria-hidden="true"></span>
          </span>
        </label>
      </section>

      <p class="rpc-saved" id="rpc-saved" role="status" aria-live="polite" hidden>
        ${t("rpc.saved")}
      </p>
    </section>
  `;

  const enabled = host.querySelector<HTMLInputElement>('[name="rpcEnabled"]')!;
  const timestamps = host.querySelector<HTMLInputElement>('[name="rpcTimestamps"]')!;
  const videoButton = host.querySelector<HTMLInputElement>('[name="rpcVideoButton"]')!;
  const channelButton = host.querySelector<HTMLInputElement>('[name="rpcChannelButton"]')!;
  const idle = host.querySelector<HTMLInputElement>('[name="rpcIdle"]')!;
  const saved = host.querySelector<HTMLElement>("#rpc-saved")!;
  const statusLine = host.querySelector<HTMLElement>("#rpc-problem")!;

  const syncForm = (value: AppSettings): void => {
    current = value;
    enabled.checked = value.rpc.enabled;
    timestamps.checked = value.rpc.showTimestamps;
    videoButton.checked = value.rpc.showVideoButton;
    channelButton.checked = value.rpc.showChannelButton;
    idle.checked = value.rpc.idleWhenPaused;
  };

  syncForm(current);

  let timer: number | undefined;
  let savedTimer: number | undefined;
  let saving = false;

  const save = async (): Promise<void> => {
    if (saving) {
      return;
    }

    const next: AppSettings = {
      ...current,
      rpc: {
        ...current.rpc,
        enabled: enabled.checked,
        showTimestamps: timestamps.checked,
        showVideoButton: videoButton.checked,
        showChannelButton: channelButton.checked,
        idleWhenPaused: idle.checked,
      },
    };

    if (JSON.stringify(next) === JSON.stringify(current)) {
      return;
    }

    saving = true;

    try {
      current = await api.settingsUpdate(next);
      saved.hidden = false;
      if (savedTimer !== undefined) {
        window.clearTimeout(savedTimer);
      }
      savedTimer = window.setTimeout(() => {
        saved.hidden = true;
      }, 1600);

      const status = await api.rpcStatus();
      applyStatus(status);
    } catch (error) {
      saved.textContent = t("common.error", { error: String(error) });
      saved.hidden = false;
    } finally {
      saving = false;
    }
  };

  const queueSave = (delay: number): void => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }

    timer = window.setTimeout(() => {
      timer = undefined;
      void save();
    }, delay);
  };

  function applyStatus(status: RpcStatus): void {
    // The switch already says whether the integration is on; only a real
    // problem deserves a line of text.
    const problem = status.state === "error" ? hintFor(status) : "";
    statusLine.textContent = problem;
    statusLine.hidden = problem === "";
  }

  applyStatus(status);

  host.addEventListener("change", () => queueSave(0));
  host.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === "text") {
      queueSave(600);
    }
  });

  await listen<RpcStatus>("rpc://status", (event) => {
    applyStatus(event.payload);
  }).catch(() => undefined);
}
