import { useState } from "react";
import type { Theme } from "../lib/theme";
import {
  TRANSLATION_LANGUAGES,
  type TranslationLanguage,
} from "../lib/translationLanguage";

type SettingsProps = {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  translationLanguage: TranslationLanguage;
  onTranslationLanguageChange: (language: TranslationLanguage) => void;
  onResetDatabase: () => Promise<void>;
  canResetDatabase: boolean;
};

export function Settings({
  theme,
  onThemeChange,
  translationLanguage,
  onTranslationLanguageChange,
  onResetDatabase,
  canResetDatabase,
}: SettingsProps) {
  const isDark = theme === "dark";
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);

  async function handleReset() {
    const confirmed = window.confirm(
      "Reset the library database? This permanently deletes all tracks, lyrics, and related data. Audio files on disk are not deleted.",
    );
    if (!confirmed) return;

    setResetting(true);
    setResetError(null);
    setResetDone(false);
    try {
      await onResetDatabase();
      setResetDone(true);
    } catch (err: unknown) {
      setResetError(
        err instanceof Error ? err.message : "Could not reset database.",
      );
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="settings-list" aria-label="App settings">
      <div className="settings-row">
        <div className="settings-row-copy">
          <span className="settings-row-label" id="theme-label">
            Dark mode
          </span>
          <span className="settings-row-desc muted">
            Use a deep purple background suited for low-light study sessions.
          </span>
        </div>

        <button
          type="button"
          role="switch"
          className="theme-switch"
          aria-labelledby="theme-label"
          aria-checked={isDark}
          onClick={() => onThemeChange(isDark ? "light" : "dark")}
        >
          <span className="theme-switch-track">
            <span className="theme-switch-thumb" aria-hidden="true" />
          </span>
          <span className="theme-switch-text">{isDark ? "On" : "Off"}</span>
        </button>
      </div>

      <div className="settings-row">
        <div className="settings-row-copy">
          <span className="settings-row-label" id="translation-language-label">
            Translation language
          </span>
          <span className="settings-row-desc muted">
            Language used when translating song lyrics.
          </span>
        </div>

        <div
          className="settings-segment"
          role="radiogroup"
          aria-labelledby="translation-language-label"
        >
          {TRANSLATION_LANGUAGES.map(({ code, label }) => {
            const selected = translationLanguage === code;
            return (
              <button
                key={code}
                type="button"
                role="radio"
                className="settings-segment-option"
                aria-checked={selected}
                onClick={() => onTranslationLanguageChange(code)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-copy">
          <span className="settings-row-label" id="reset-db-label">
            Reset library database
          </span>
          <span className="settings-row-desc muted">
            Clear all tracks and lyrics from Melodica’s local database. Your
            music files stay on disk.
          </span>
          {resetError && <p className="error settings-inline-msg">{resetError}</p>}
          {resetDone && !resetError && (
            <p className="muted settings-inline-msg">Database reset.</p>
          )}
        </div>

        <button
          type="button"
          className="btn btn-danger"
          aria-labelledby="reset-db-label"
          disabled={!canResetDatabase || resetting}
          onClick={() => void handleReset()}
        >
          {resetting ? "Resetting…" : "Reset database"}
        </button>
      </div>
    </section>
  );
}
