import { useEffect, useMemo, useRef, useState } from "react";
import type { LyricsMatch, LyricsState } from "../lib/tauri";
import { formatTime, languageLabel } from "../lib/format";
import { SONG_LANGUAGES } from "../lib/songLanguage";

export type TrackSearchState = {
  activeQuery: string;
  searching: boolean;
  matches: LyricsMatch[];
  preferredMatchId: number | null;
  error: string | null;
};

type LyricsEditorProps = {
  trackId: number;
  trackTitle: string;
  trackArtist: string | null;
  languageCode: string | null;
  languageManual: boolean;
  lyrics: LyricsState;
  isProcessing: boolean;
  isDetectingLanguage: boolean;
  languagePreviewWarning: string | null;
  searchState: TrackSearchState | undefined;
  onRequestSearch: (query: string) => void;
  onProcessLyrics: (pasted: string, lrclibId: number | null) => void;
  onSetLanguage: (languageCode: string | null, lrclibId: number | null) => void;
  onPreviewLanguage: (lrclibId: number | null) => void;
};

export function LyricsEditor({
  trackId,
  trackTitle,
  trackArtist,
  languageCode,
  languageManual,
  lyrics,
  isProcessing,
  isDetectingLanguage,
  languagePreviewWarning,
  searchState,
  onRequestSearch,
  onProcessLyrics,
  onSetLanguage,
  onPreviewLanguage,
}: LyricsEditorProps) {
  const defaultQuery = useMemo(
    () => [trackTitle, trackArtist].filter(Boolean).join(" "),
    [trackTitle, trackArtist],
  );
  const [query, setQuery] = useState(defaultQuery);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pasted, setPasted] = useState("");
  const searchedRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const prevSelectedRef = useRef<number | null | undefined>(undefined);

  const searching = searchState?.searching ?? false;
  const resultsForQuery =
    searchState?.activeQuery === query ? searchState : undefined;
  const matches = resultsForQuery?.matches ?? [];
  const searchError = resultsForQuery?.error ?? null;

  const languageOptions = useMemo(() => {
    const code = languageCode?.trim().toLowerCase() ?? "";
    if (!code || SONG_LANGUAGES.some((opt) => opt.code === code)) {
      return SONG_LANGUAGES;
    }
    return [
      ...SONG_LANGUAGES,
      { code, label: `${languageLabel(code)} (${code})` },
    ];
  }, [languageCode]);

  const selectValue = languageCode?.trim().toLowerCase() ?? "";

  useEffect(() => {
    setQuery(defaultQuery);
  }, [defaultQuery]);

  useEffect(() => {
    if (searchedRef.current) return;
    searchedRef.current = true;
    onRequestSearch(defaultQuery);
    // Search once when the editor mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  useEffect(() => {
    searchedRef.current = false;
    prevSelectedRef.current = undefined;
  }, [trackId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setSelectedId((current) => {
      if (current != null && matches.some((match) => match.id === current)) {
        return current;
      }
      const preferred = resultsForQuery?.preferredMatchId ?? null;
      if (preferred != null && matches.some((match) => match.id === preferred)) {
        return preferred;
      }
      return matches[0]?.id ?? null;
    });
  }, [matches, resultsForQuery?.preferredMatchId]);

  // Select-time detect when the match changes (including duration-matched auto-select).
  // Skip when a language is already set; backend prefers processed lyrics over LRCLIB text.
  useEffect(() => {
    if (searching) return;

    if (languageCode?.trim()) {
      prevSelectedRef.current = selectedId;
      return;
    }

    const prev = prevSelectedRef.current;
    if (prev === undefined) {
      prevSelectedRef.current = selectedId;
      // Always attempt once search settles — uses processed lyrics, else LRCLIB match.
      onPreviewLanguage(selectedId);
      return;
    }
    if (prev === selectedId) return;
    prevSelectedRef.current = selectedId;
    onPreviewLanguage(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, searching, trackId, languageCode]);

  function requestSearch(nextQuery: string) {
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      onRequestSearch(nextQuery);
    }, 300);
  }

  function detectedLabel(): string | null {
    if (languageManual || !languageCode) return null;
    return languageLabel(languageCode);
  }

  return (
    <div className="lyrics-panel">
      <div className="lyrics-source">
        <p className="muted lyrics-hint">
          Process saves lyrics, then translates using the language below. Language
          auto-detects from processed lyrics when unset; override does not Process.
        </p>
        <div className="lyrics-language-row">
          <label className="field-label" htmlFor={`lyrics-lang-${trackId}`}>
            Song language
          </label>
          <select
            id={`lyrics-lang-${trackId}`}
            className="field"
            value={
              languageOptions.some((opt) => opt.code === selectValue)
                ? selectValue
                : ""
            }
            onChange={(e) => {
              const next = e.target.value;
              onSetLanguage(next ? next : null, selectedId);
            }}
            disabled={isProcessing}
          >
            {languageOptions.map((opt) => {
              let label = opt.label;
              if (opt.code && opt.code === selectValue) {
                label = languageManual
                  ? `${opt.label} (manual)`
                  : `${opt.label} (detected)`;
              }
              return (
                <option key={opt.code || "auto"} value={opt.code}>
                  {label}
                </option>
              );
            })}
          </select>
          {isDetectingLanguage && (
            <p className="muted lyrics-hint" role="status" aria-live="polite">
              Detecting language from lyrics…
            </p>
          )}
          {!isDetectingLanguage && detectedLabel() && !languageManual && (
            <p className="muted lyrics-hint" role="status" aria-live="polite">
              Auto-detected: {detectedLabel()}
            </p>
          )}
          {languagePreviewWarning && (
            <p className="error lyrics-hint">{languagePreviewWarning}</p>
          )}
          <p className="muted lyrics-hint">
            Override bad auto-detect (e.g. romanized Japanese). Changing language
            only sets a preference — Process applies lyrics and translation.
          </p>
        </div>
        <div className="lyrics-search-row">
          <label className="field-label" htmlFor={`lyrics-search-${trackId}`}>
            Find lyrics
          </label>
          <div className="lyrics-search-controls">
            <input
              id={`lyrics-search-${trackId}`}
              className="field"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  requestSearch(query);
                }
              }}
              placeholder="Title and artist"
              disabled={isProcessing}
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => requestSearch(query)}
              disabled={searching || isProcessing}
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
        </div>
        {searching && (
          <p className="search-status" role="status" aria-live="polite">
            <span className="search-status-dot" aria-hidden="true" />
            Searching LRCLIB — you can keep using the app.
          </p>
        )}
        <label className="field-label" htmlFor={`lyrics-match-${trackId}`}>
          Matching songs
        </label>
        <select
          id={`lyrics-match-${trackId}`}
          className="field"
          value={selectedId == null ? "" : String(selectedId)}
          onChange={(e) =>
            setSelectedId(e.target.value ? Number(e.target.value) : null)
          }
          disabled={searching || isProcessing || matches.length === 0}
        >
          {matches.length === 0 ? (
            <option value="">
              {searching ? "Searching…" : "No matches yet"}
            </option>
          ) : (
            <>
              <option value="">None — transcribe audio</option>
              {matches.map((match) => (
                <option key={match.id} value={match.id}>
                  {matchLabel(match)}
                </option>
              ))}
            </>
          )}
        </select>
        {searchError && <p className="error">{searchError}</p>}
        <label className="field-label" htmlFor={`lyrics-paste-${trackId}`}>
          Or paste lyrics
        </label>
        <textarea
          id={`lyrics-paste-${trackId}`}
          className="field lyrics-paste"
          rows={4}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="Paste the original lyrics here to overwrite any other source."
          disabled={isProcessing}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={isProcessing}
          onClick={() => onProcessLyrics(pasted, selectedId)}
        >
          {isProcessing ? "Processing…" : "Process lyrics"}
        </button>
      </div>

      {isProcessing && (
        <p className="muted">Still extracting lyrics in the background…</p>
      )}
      {lyrics === "loading" && <p>Loading lyrics…</p>}
      {lyrics === "error" && (
        <p className="error">Could not load lyrics.</p>
      )}
      {Array.isArray(lyrics) && lyrics.length === 0 && (
        <p className="muted">
          No lyrics yet. Search for a match, paste lyrics, then Process.
          Process with both empty transcribes the audio.
        </p>
      )}
      {Array.isArray(lyrics) && lyrics.length > 0 && (
        <ul className="lyrics-lines">
          {lyrics.map((line) => (
            <li key={line.id}>{line.originalText}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function matchLabel(match: LyricsMatch): string {
  const parts = [match.artistName, match.trackName];
  if (match.albumName) parts.push(match.albumName);
  if (match.durationSeconds != null && match.durationSeconds > 0) {
    parts.push(formatTime(match.durationSeconds * 1000));
  }
  let label = parts.join(" — ");
  if (match.instrumental) label += " (instrumental)";
  return label;
}
