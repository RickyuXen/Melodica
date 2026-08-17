import type { LyricLine, Track } from "../lib/tauri";
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
}: TrackItemProps) {
  const seekMax = Math.max(durationMs, 1);

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
        <button
          type="button"
          className="btn btn-ghost lyrics-toggle"
          onClick={onToggleLyrics}
        >
          {lyricsOpen ? "Hide lyrics" : "View lyrics"}
        </button>
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

      {lyricsOpen && <LyricsPanel lyrics={lyrics} isProcessing={isProcessing} />}
    </li>
  );
}

function LyricsPanel({
  lyrics,
  isProcessing,
}: {
  lyrics: LyricsState;
  isProcessing: boolean;
}) {
  return (
    <div className="lyrics-panel">
      {isProcessing && (
        <p className="muted">Still extracting lyrics in the background…</p>
      )}
      {lyrics === "loading" && <p>Loading lyrics…</p>}
      {lyrics === "error" && (
        <p className="error">Could not load lyrics.</p>
      )}
      {Array.isArray(lyrics) && lyrics.length === 0 && (
        <p className="muted">
          No lyrics yet — ensure the Melodica sidecar is running for
          transcription (<code>npm run sidecar:dev</code>).
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
