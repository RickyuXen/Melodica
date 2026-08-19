import { useEffect, useMemo, useRef, useState } from "react";
import type { LyricLine, LyricsMatch, Track } from "../lib/tauri";
import { formatTime, languageLabel } from "../lib/format";

type LyricsState = LyricLine[] | "loading" | "error" | undefined;

type TrackItemProps = {
  track: Track;
  lyrics: LyricsState;
  lyricsOpen: boolean;
  isCurrent: boolean;
  isProcessing: boolean;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  canControl: boolean;
  onToggleLyrics: () => void;
  onPlayPause: () => void;
  onScrub: (ms: number) => void;
  onSeekCommit: (ms: number) => void;
  onSeekCancel: () => void;
  onSeekPointerDown: () => void;
  onSearchLyrics: (query: string) => Promise<LyricsMatch[]>;
  onProcessLyrics: (pasted: string, lrclibId: number | null) => void;
};

export function TrackItem({
  track,
  lyrics,
  lyricsOpen,
  isCurrent,
  isProcessing,
  playing,
  positionMs,
  durationMs,
  canControl,
  onToggleLyrics,
  onPlayPause,
  onScrub,
  onSeekCommit,
  onSeekCancel,
  onSeekPointerDown,
  onSearchLyrics,
  onProcessLyrics,
}: TrackItemProps) {
  const seekMax = Math.max(durationMs, 1);
  const defaultQuery = useMemo(
    () => [track.title, track.artist].filter(Boolean).join(" "),
    [track.title, track.artist],
  );
  const [query, setQuery] = useState(defaultQuery);
  const [matches, setMatches] = useState<LyricsMatch[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pasted, setPasted] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchedRef = useRef(false);

  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    setQuery(defaultQuery);
  }, [defaultQuery]);

  useEffect(() => {
    if (!lyricsOpen || searchedRef.current) return;
    searchedRef.current = true;
    void runSearch(defaultQuery);
    // Search once when the panel first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricsOpen]);

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  async function runSearch(nextQuery: string) {
    setSearching(true);
    setSearchError(null);
    try {
      const results = await onSearchLyrics(nextQuery);
      setMatches(results);
      setSelectedId((current) => {
        if (current != null && results.some((match) => match.id === current)) {
          return current;
        }
        return results[0]?.id ?? null;
      });
    } catch (err: unknown) {
      setMatches([]);
      setSelectedId(null);
      setSearchError(
        err instanceof Error ? err.message : "Could not search for lyrics.",
      );
    } finally {
      setSearching(false);
    }
  }

  function requestSearch(nextQuery: string) {
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void runSearch(nextQuery);
    }, 300);
  }

  function handleProcess() {
    onProcessLyrics(pasted, selectedId);
  }

  return (
    <li className={`track-item${isCurrent ? " is-current" : ""}`}>
      <div className="track-row">
        <div className="track-meta">
          <strong>{track.title}</strong>
          {track.artist && <span className="muted"> — {track.artist}</span>}
          {track.languageCode && (
            <span className="lang-tag">
              {languageLabel(track.languageCode)}
            </span>
          )}
          {isProcessing && (
            <span className="processing-tag">Processing…</span>
          )}
        </div>
        <div className="track-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!canControl || isProcessing}
            onClick={handleProcess}
          >
            Process
          </button>
          <button
            type="button"
            className="btn btn-ghost lyrics-toggle"
            onClick={onToggleLyrics}
          >
            {lyricsOpen ? "Hide lyrics" : "View lyrics"}
          </button>
        </div>
      </div>

      <div className="player-row">
        <button
          type="button"
          className="btn btn-ghost play-toggle"
          disabled={!canControl}
          onClick={onPlayPause}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <div className="seek-wrap">
          <input
            type="range"
            className="seek"
            min={0}
            max={seekMax}
            step={100}
            value={Math.min(positionMs, seekMax)}
            disabled={!canControl || durationMs <= 0}
            aria-label={`Seek ${track.title}`}
            onPointerDown={onSeekPointerDown}
            onChange={(e) => onScrub(Number(e.target.value))}
            onPointerUp={(e) =>
              onSeekCommit(Number((e.target as HTMLInputElement).value))
            }
            onPointerCancel={onSeekCancel}
            onKeyUp={(e) =>
              onSeekCommit(Number((e.target as HTMLInputElement).value))
            }
          />
          <div className="seek-times" aria-hidden="true">
            <span>{formatTime(positionMs)}</span>
            <span>{formatTime(durationMs)}</span>
          </div>
        </div>
      </div>

      {lyricsOpen && (
        <LyricsPanel
          trackId={track.id}
          lyrics={lyrics}
          isProcessing={isProcessing}
          query={query}
          onQueryChange={setQuery}
          onSearch={() => requestSearch(query)}
          searching={searching}
          searchError={searchError}
          matches={matches}
          selectedId={selectedId}
          onSelectId={setSelectedId}
          pasted={pasted}
          onPastedChange={setPasted}
        />
      )}
    </li>
  );
}

function LyricsPanel({
  trackId,
  lyrics,
  isProcessing,
  query,
  onQueryChange,
  onSearch,
  searching,
  searchError,
  matches,
  selectedId,
  onSelectId,
  pasted,
  onPastedChange,
}: {
  trackId: number;
  lyrics: LyricsState;
  isProcessing: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  searching: boolean;
  searchError: string | null;
  matches: LyricsMatch[];
  selectedId: number | null;
  onSelectId: (id: number | null) => void;
  pasted: string;
  onPastedChange: (value: string) => void;
}) {
  return (
    <div className="lyrics-panel">
      <div className="lyrics-source">
        <p className="muted lyrics-hint">
          Process uses pasted text, or the selected song, or transcription if
          you leave both empty.
        </p>
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
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSearch();
                }
              }}
              placeholder="Title and artist"
              disabled={searching || isProcessing}
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onSearch}
              disabled={searching || isProcessing}
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
        </div>
        <label className="field-label" htmlFor={`lyrics-match-${trackId}`}>
          Matching songs
        </label>
        <select
          id={`lyrics-match-${trackId}`}
          className="field"
          value={selectedId == null ? "" : String(selectedId)}
          onChange={(e) =>
            onSelectId(e.target.value ? Number(e.target.value) : null)
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
          onChange={(e) => onPastedChange(e.target.value)}
          placeholder="Paste the original lyrics here to overwrite any other source."
          disabled={isProcessing}
        />
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
