import { api } from "../lib/api";
import { en, type TranslationKey } from "./locales/en";
import { ptBR } from "./locales/pt-BR";

export type { TranslationKey } from "./locales/en";

export type Language = "en" | "pt-BR";

export const LANGUAGES: ReadonlyArray<{ id: Language; label: string }> = [
  { id: "en", label: "English" },
  { id: "pt-BR", label: "Português (Brasil)" },
];

const dictionaries: Record<Language, Record<TranslationKey, string>> = {
  en,
  "pt-BR": ptBR,
};

let current: Language = "en";

type LanguageListener = (lang: Language) => void;
const languageListeners = new Set<LanguageListener>();

export function onLanguageChange(listener: LanguageListener): () => void {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}

export function normalizeLanguage(value: string | null | undefined): Language {
  return value?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

export function getLanguage(): Language {
  return current;
}

export function getLocale(): string {
  return current;
}

export function setLanguage(value: string): void {
  const next = normalizeLanguage(value);
  current = next;
  document.documentElement.lang = current;
  for (const listener of languageListeners) {
    try {
      listener(current);
    } catch (e) {
      console.error("language listener error:", e);
    }
  }
}

export async function initI18n(): Promise<void> {
  try {
    const settings = await api.settingsGet();
    setLanguage(settings.general.language);
  } catch {
    setLanguage(typeof navigator !== "undefined" ? navigator.language : "en");
  }
}

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const template = dictionaries[current][key] ?? en[key];

  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}