import type { LyricLine, Track } from "../lib/tauri";
import { formatTime, languageLabel } from "../lib/format";
import { LyricsDisplay } from "./LyricsDisplay";
import { LyricsEditor, type TrackSearchState } from "./LyricsEditor";

type LyricsState = LyricLine[] | "loading" | "error" | undefined;

type TrackItemProps = {
  track: Track;
  mode: "library" | "edit";
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
  searchState: TrackSearchState | undefined;
  onRequestSearch: (query: string) => void;
  onProcessLyrics: (pasted: string, lrclibId: number | null) => void;
};

export function TrackItem({
  track,
  mode,
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
  searchState,
  onRequestSearch,
  onProcessLyrics,
}: TrackItemProps) {
  const seekMax = Math.max(durationMs, 1);

  return (
    <li className={`track-item${isCurrent ? " is-current" : ""}`}>
      {mode === "library" && (
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
              className="btn btn-ghost lyrics-toggle"
              onClick={onToggleLyrics}
            >
              {lyricsOpen ? "Hide lyrics" : "View lyrics"}
            </button>
          </div>
        </div>
      )}

      {mode === "library" && (
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
      )}

      {mode === "library" && lyricsOpen && (
        <div className="lyrics-panel">
          <LyricsDisplay
            lyrics={lyrics}
            languageCode={track.languageCode}
            positionMs={positionMs}
            isCurrent={isCurrent}
            onSeekLine={onSeekCommit}
          />
        </div>
      )}

      {mode === "edit" && (
        <LyricsEditor
          trackId={track.id}
          trackTitle={track.title}
          trackArtist={track.artist}
          lyrics={lyrics}
          isProcessing={isProcessing}
          searchState={searchState}
          onRequestSearch={onRequestSearch}
          onProcessLyrics={onProcessLyrics}
        />
      )}
    </li>
  );
}
