export type TranslationLanguage = "en" | "fr";

export const TRANSLATION_LANGUAGES: {
  code: TranslationLanguage;
  label: string;
}[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
];

const STORAGE_KEY = "melodica-translation-language";
const DEFAULT: TranslationLanguage = "en";

export function getStoredTranslationLanguage(): TranslationLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "fr") return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

export function setStoredTranslationLanguage(language: TranslationLanguage) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* ignore */
  }
}
