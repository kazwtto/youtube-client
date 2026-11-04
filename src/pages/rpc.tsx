import { createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { t, type TranslationKey } from "../i18n";
import { api, type AppSettings, type RpcSettings, type RpcStatus } from "../lib/api";
import { SwitchSetting } from "../components/setting-row";

function statusLabel(status: RpcStatus): string {
  if (status.state === "disabled") return t("rpc.disabledHint");
  if (status.state === "connected") return t("rpc.connectedHint");
  if (status.state === "notConfigured") return t("rpc.notConfiguredDetail");
  if (status.state === "error") {
    return status.detail
      ? t("rpc.errorDetail", { error: status.detail })
      : t("rpc.state.error");
  }
  const key = `rpc.state.${status.state}` as TranslationKey;
  return t(key);
}

interface RpcPageProps {
  initialSettings: AppSettings;
  initialStatus: RpcStatus;
}

function RpcPage(props: RpcPageProps) {
  const [settings, setSettings] = createSignal(props.initialSettings);
  const [draft, setDraft] = createSignal<RpcSettings>(props.initialSettings.rpc);
  const [status, setStatus] = createSignal(props.initialStatus);
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  let saveTimer: number | undefined;
  let messageTimer: number | undefined;
  let saving = false;
  let pending = false;
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  let editVersion = 0;

  onMount(() => {
    void listen<RpcStatus>("rpc://status", (event) => setStatus(event.payload))
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
  });

  onCleanup(() => {
    disposed = true;
    unlisten?.();
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    if (messageTimer !== undefined) window.clearTimeout(messageTimer);
  });

  const save = async (): Promise<void> => {
    if (saving) {
      pending = true;
      return;
    }
    if (JSON.stringify(draft()) === JSON.stringify(settings().rpc)) return;

    const savedVersion = editVersion;
    saving = true;
    setError("");
    try {
      const updated = await api.settingsUpdate({ ...settings(), rpc: draft() });
      setSettings(updated);
      if (editVersion === savedVersion) setDraft(updated.rpc);
      setStatus(await api.rpcStatus());
      setMessage(t("rpc.saved"));
      if (messageTimer !== undefined) window.clearTimeout(messageTimer);
      messageTimer = window.setTimeout(() => setMessage(""), 1600);
    } catch (reason) {
      setError(t("common.error", { error: String(reason) }));
    } finally {
      saving = false;
      if (pending) {
        pending = false;
        queueSave();
      }
    }
  };

  const queueSave = (): void => {
    if (saveTimer !== undefined) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      void save();
    }, 0);
  };

  const update = (key: keyof RpcSettings, value: boolean): void => {
    editVersion += 1;
    setDraft((previous) => ({ ...previous, [key]: value }));
    queueSave();
  };

  // The switch already says whether the integration is on; only a real
  // problem deserves a line of text.
  return (
    <section class="page page--discord">
      <header class="page__header">
        <h1>{t("rpc.title")}</h1>
        <p class="page__lead">{t("rpc.lead")}</p>
      </header>

      <section class="yt-section">
        <h2 class="yt-section__title">{t("rpc.section")}</h2>
        <SwitchSetting checked={draft().enabled} label={t("rpc.enabled")} hint={t("rpc.enabledHint")} onChange={(event) => update("enabled", event.currentTarget.checked)} />
        <p class="rpc-problem" role="status" aria-live="polite" hidden={status().state !== "error"}>{statusLabel(status())}</p>
      </section>

      <section class="yt-section">
        <h2 class="yt-section__title">{t("rpc.displayTitle")}</h2>
        <SwitchSetting checked={draft().showTimestamps} label={t("rpc.timestamps")} onChange={(event) => update("showTimestamps", event.currentTarget.checked)} />
        <SwitchSetting checked={draft().showVideoButton} label={t("rpc.videoButton")} onChange={(event) => update("showVideoButton", event.currentTarget.checked)} />
        <SwitchSetting checked={draft().showChannelButton} label={t("rpc.channelButton")} onChange={(event) => update("showChannelButton", event.currentTarget.checked)} />
        <SwitchSetting checked={draft().idleWhenPaused} label={t("rpc.idle")} hint={t("rpc.idleHint")} onChange={(event) => update("idleWhenPaused", event.currentTarget.checked)} />
      </section>

      <p id="rpc-saved" class="rpc-saved" role="status" aria-live="polite" hidden={!message() && !error()}>{message() || error()}</p>
    </section>
  );
}

export async function renderRpc(host: HTMLElement): Promise<void> {
  const [initialStatus, initialSettings] = await Promise.all([api.rpcStatus(), api.settingsGet()]);
  render(() => <RpcPage initialSettings={initialSettings} initialStatus={initialStatus} />, host);
}
