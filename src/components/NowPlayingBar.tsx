import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { formatTime } from "../lib/format";
import type { PlaybackStatus, Track } from "../lib/tauri";
import { VolumeSlider } from "./VolumeSlider";

type NowPlayingBarProps = {
  track: Track | undefined;
  playback: PlaybackStatus;
  volume: number;
  positionMs: number;
  durationMs: number;
  canControl: boolean;
  onPlayPause: () => void;
  onPlayPrevious: () => void;
  onPlayNext: () => void;
  onScrub: (ms: number) => void;
  onSeekCommit: (ms: number) => void;
  onSeekCancel: () => void;
  onSeekPointerDown: () => void;
  onVolumeChange: (volume: number) => void;
  onTrackClick: () => void;
  hasTracks: boolean;
};

export function NowPlayingBar({
  track,
  playback,
  volume,
  positionMs,
  durationMs,
  canControl,
  onPlayPause,
  onPlayPrevious,
  onPlayNext,
  onScrub,
  onSeekCommit,
  onSeekCancel,
  onSeekPointerDown,
  onVolumeChange,
  onTrackClick,
  hasTracks,
}: NowPlayingBarProps) {
  const playing = playback.playing;
  const seekMax = Math.max(durationMs, 1);

  return (
    <footer className="now-playing-bar" aria-label="Now playing">
      <div className="now-playing-controls">
        <button
          type="button"
          className="btn btn-icon"
          disabled={!canControl || !hasTracks}
          onClick={onPlayPrevious}
          aria-label="Previous track"
        >
          <SkipBack strokeWidth={2} />
        </button>
        <button
          type="button"
          className="btn btn-icon btn-icon-primary"
          disabled={!canControl || !track}
          onClick={onPlayPause}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <Pause strokeWidth={2} />
          ) : (
            <Play strokeWidth={2} />
          )}
        </button>
        <button
          type="button"
          className="btn btn-icon"
          disabled={!canControl || !hasTracks}
          onClick={onPlayNext}
          aria-label="Next track"
        >
          <SkipForward strokeWidth={2} />
        </button>
      </div>

      <div className="now-playing-seek">
        <input
          type="range"
          className="seek"
          min={0}
          max={seekMax}
          step={100}
          value={Math.min(positionMs, seekMax)}
          disabled={!canControl || !track || durationMs <= 0}
          aria-label="Seek"
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

      <VolumeSlider
        value={volume}
        onChange={onVolumeChange}
        disabled={!canControl}
      />

      {track ? (
        <button
          type="button"
          className="now-playing-track"
          onClick={onTrackClick}
          aria-label={`View lyrics for ${track.title}`}
        >
          <span className="now-playing-title">{track.title}</span>
          {track.artist && (
            <span className="now-playing-artist muted">{track.artist}</span>
          )}
        </button>
      ) : (
        <div className="now-playing-track now-playing-track--empty muted">
          No track selected
        </div>
      )}
    </footer>
  );
}
