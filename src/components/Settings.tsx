import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { Theme } from "../lib/theme";
import {
  TRANSLATION_LANGUAGES,
  type TranslationLanguage,
} from "../lib/translationLanguage";
import {
  getTranslateApiKeyStatus,
  openExternalUrl,
  setTranslateApiKey,
} from "../lib/tauri";

const GEMINI_API_KEY_URL = "https://aistudio.google.com/apikey";

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

  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeyMessage, setApiKeyMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getTranslateApiKeyStatus()
      .then((status) => {
        if (cancelled) return;
        setHasApiKey(status.hasKey);
        setApiKeyDraft(status.apiKey ?? "");
      })
      .catch(() => {
        if (!cancelled) setHasApiKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function handleSaveApiKey() {
    setApiKeyBusy(true);
    setApiKeyError(null);
    setApiKeyMessage(null);
    try {
      const status = await setTranslateApiKey(apiKeyDraft);
      setHasApiKey(status.hasKey);
      setApiKeyDraft(status.apiKey ?? "");
      setApiKeyMessage(
        status.hasKey
          ? "API key saved. It persists in Melodica’s local settings across restarts."
          : "API key cleared. Add a key here to translate lyrics.",
      );
    } catch (err: unknown) {
      setApiKeyError(
        err instanceof Error ? err.message : "Could not save API key.",
      );
    } finally {
      setApiKeyBusy(false);
    }
  }

  async function handleClearApiKey() {
    setApiKeyBusy(true);
    setApiKeyError(null);
    setApiKeyMessage(null);
    try {
      const status = await setTranslateApiKey(null);
      setHasApiKey(status.hasKey);
      setApiKeyDraft("");
      setApiKeyVisible(false);
      setApiKeyMessage(
        "API key cleared. Add a key here to translate lyrics.",
      );
    } catch (err: unknown) {
      setApiKeyError(
        err instanceof Error ? err.message : "Could not clear API key.",
      );
    } finally {
      setApiKeyBusy(false);
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
            Language used when translating song lyrics. Generation currently
            targets English; other options are reserved for later.
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

      <div className="settings-row settings-row-stack">
        <div className="settings-row-copy">
          <span className="settings-row-label" id="translate-api-key-label">
            Translation API key
          </span>
          <span className="settings-row-desc muted">
            Google Gemini API key for lyric translation (Flash by default).
            Required for Process translation on a downloaded app. Saved keys are
            stored on this computer and kept after a database reset.
          </span>
          <ol className="settings-api-key-steps muted">
            <li>
              Open{" "}
              <a
                className="settings-external-link"
                href={GEMINI_API_KEY_URL}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  void openExternalUrl(GEMINI_API_KEY_URL);
                }}
              >
                Google AI Studio
              </a>{" "}
              and sign in with a Google account.
            </li>
            <li>
              Click <strong>Create API key</strong> (create or pick a Google Cloud
              project if prompted).
            </li>
            <li>Copy the key once, then paste it below and save.</li>
          </ol>
          {hasApiKey && (
            <p className="muted settings-inline-msg">
              A key is saved on this device.
            </p>
          )}
          {apiKeyError && (
            <p className="error settings-inline-msg">{apiKeyError}</p>
          )}
          {apiKeyMessage && !apiKeyError && (
            <p className="muted settings-inline-msg">{apiKeyMessage}</p>
          )}
        </div>

        <div className="settings-api-key">
          <div className="settings-api-key-field">
            <input
              id="translate-api-key-input"
              className="field"
              type={apiKeyVisible ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder="AIza…"
              aria-labelledby="translate-api-key-label"
              value={apiKeyDraft}
              disabled={apiKeyBusy || !canResetDatabase}
              onChange={(e) => setApiKeyDraft(e.target.value)}
            />
            <button
              type="button"
              className="settings-api-key-reveal"
              aria-label={apiKeyVisible ? "Hide API key" : "Show API key"}
              aria-pressed={apiKeyVisible}
              disabled={apiKeyBusy || !canResetDatabase || !apiKeyDraft}
              onClick={() => setApiKeyVisible((v) => !v)}
            >
              {apiKeyVisible ? (
                <EyeOff aria-hidden="true" />
              ) : (
                <Eye aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="settings-api-key-actions">
            <button
              type="button"
              className="btn"
              disabled={
                apiKeyBusy || !canResetDatabase || !apiKeyDraft.trim()
              }
              onClick={() => void handleSaveApiKey()}
            >
              {apiKeyBusy ? "Saving…" : "Save key"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={apiKeyBusy || !canResetDatabase || !hasApiKey}
              onClick={() => void handleClearApiKey()}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-copy">
          <span className="settings-row-label" id="reset-db-label">
            Reset library database
          </span>
          <span className="settings-row-desc muted">
            Clear all tracks and lyrics from Melodica’s local database. Your
            music files stay on disk. Your translation API key is kept.
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
