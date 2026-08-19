import type { Theme } from "../lib/theme";

type SettingsProps = {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
};

export function Settings({ theme, onThemeChange }: SettingsProps) {
  const isDark = theme === "dark";

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
    </section>
  );
}
