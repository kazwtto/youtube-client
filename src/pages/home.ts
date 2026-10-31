import { t } from "../i18n";

export function renderHome(host: HTMLElement): void {
  host.innerHTML = `
    <section class="page page--home">
      <header class="page__header">
        <p class="eyebrow">${t("home.eyebrow")}</p>
        <h1>${t("home.title")}</h1>
        <p class="page__lead">${t("home.lead")}</p>
      </header>

      <div class="card">
        <h2>${t("home.gettingStarted")}</h2>
        <ol class="steps">
          <li>${t("home.step1")}</li>
          <li>${t("home.step2")}</li>
          <li>${t("home.step3")}</li>
          <li>${t("home.step4")}</li>
        </ol>
      </div>
    </section>
  `;
}