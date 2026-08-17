import { useEffect, useRef, useState } from "react";
import {
  getAppInfo,
  getLyrics,
  listTracks,
  onPipelineFailed,
  onPipelineFinished,
  pickAudioFile,
  playbackPlay,
  playbackSeek,
  playbackStatus,
  playbackToggle,
  processUpload,
  type AppInfo,
  type LyricLine,
  type PlaybackStatus,
  type Track,
} from "./lib/tauri";
import "./App.css";

type ConnectionState =
  | { status: "checking" }
  | { status: "connected"; info: AppInfo }
  | { status: "error"; message: string };

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function languageLabel(code: string): string {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    return names.of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function App() {
  const [connection, setConnection] = useState<ConnectionState>({
    status: "checking",
  });
  const [tracks, setTracks] = useState<Track[]>([]);
  const [lyricsByTrack, setLyricsByTrack] = useState<
    Record<number, LyricLine[] | "loading" | "error">
  >({});
  const [openTrackId, setOpenTrackId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [playback, setPlayback] = useState<PlaybackStatus>({
    trackId: null,
    playing: false,
    positionMs: 0,
    durationMs: 0,
  });
  const [scrub, setScrub] = useState<{ trackId: number; ms: number } | null>(
    null,
  );
  const seekingRef = useRef(false);

  async function refreshTracks() {
    const rows = await listTracks();
    setTracks(rows);
  }

  useEffect(() => {
    let cancelled = false;

    getAppInfo()
      .then(async (info) => {
        if (cancelled) return;
        setConnection({ status: "connected", info });
        await refreshTracks();
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to reach Rust core";
          setConnection({ status: "error", message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (connection.status !== "connected") return;

    let cancelled = false;
    let unlistenFinished: (() => void) | undefined;
    let unlistenFailed: (() => void) | undefined;

    void (async () => {
      unlistenFinished = await onPipelineFinished((track) => {
        if (cancelled) return;
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(track.id);
          return next;
        });
        setTracks((prev) => {
          const idx = prev.findIndex((t) => t.id === track.id);
          if (idx === -1) return [track, ...prev];
          const next = [...prev];
          next[idx] = track;
          return next;
        });
        setLyricsByTrack((prev) => {
          const next = { ...prev };
          delete next[track.id];
          return next;
        });
      });

      unlistenFailed = await onPipelineFailed((error) => {
        if (cancelled) return;
        setProcessingIds((prev) => {
          const next = new Set(prev);
          next.delete(error.trackId);
          return next;
        });
        setUploadError(error.message);
        void refreshTracks();
      });
    })();

    return () => {
      cancelled = true;
      unlistenFinished?.();
      unlistenFailed?.();
    };
  }, [connection.status]);

  useEffect(() => {
    if (connection.status !== "connected") return;

    let cancelled = false;

    async function poll() {
      try {
        const status = await playbackStatus();
        if (cancelled || seekingRef.current) return;
        setPlayback(status);
        if (status.trackId != null && status.durationMs > 0) {
          setTracks((prev) =>
            prev.map((t) =>
              t.id === status.trackId &&
              (t.durationMs == null || t.durationMs <= 0)
                ? { ...t, durationMs: status.durationMs }
                : t,
            ),
          );
        }
      } catch {
        /* ignore transient poll errors */
      }
    }

    poll();
    const id = window.setInterval(poll, 250);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [connection.status]);

  async function onUploadClick() {
    setBusy(true);
    setUploadError(null);

    try {
      const path = await pickAudioFile();
      if (!path) return;

      const track = await processUpload(path);
      setProcessingIds((prev) => new Set(prev).add(track.id));
      setOpenTrackId(null);
      await refreshTracks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setUploadError(message);
      try {
        await refreshTracks();
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }

  async function onToggleLyrics(trackId: number) {
    if (openTrackId === trackId) {
      setOpenTrackId(null);
      return;
    }

    setOpenTrackId(trackId);

    if (lyricsByTrack[trackId] && lyricsByTrack[trackId] !== "error") {
      return;
    }

    setLyricsByTrack((prev) => ({ ...prev, [trackId]: "loading" }));
    try {
      const lines = await getLyrics(trackId);
      setLyricsByTrack((prev) => ({ ...prev, [trackId]: lines }));
    } catch {
      setLyricsByTrack((prev) => ({ ...prev, [trackId]: "error" }));
    }
  }

  async function onPlayPause(track: Track) {
    setPlaybackError(null);
    try {
      const isCurrent = playback.trackId === track.id;
      const finished =
        isCurrent &&
        !playback.playing &&
        playback.durationMs > 0 &&
        playback.positionMs >= playback.durationMs;
      const status =
        isCurrent && !finished
          ? await playbackToggle()
          : await playbackPlay(track.id);
      applyPlayback(status);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setPlaybackError(message);
    }
  }

  function applyPlayback(status: PlaybackStatus) {
    setPlayback(status);
    setScrub(null);
    if (status.trackId != null && status.durationMs > 0) {
      setTracks((prev) =>
        prev.map((t) =>
          t.id === status.trackId && (t.durationMs == null || t.durationMs <= 0)
            ? { ...t, durationMs: status.durationMs }
            : t,
        ),
      );
    }
  }

  async function onSeekCommit(track: Track, valueMs: number) {
    seekingRef.current = true;
    setPlaybackError(null);
    try {
      if (playback.trackId !== track.id) {
        await playbackPlay(track.id);
      }
      const status = await playbackSeek(valueMs);
      applyPlayback(status);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setPlaybackError(message);
    } finally {
      seekingRef.current = false;
      setScrub(null);
    }
  }

  const processingCount = processingIds.size;

  return (
    <main className="shell">
      <header className="brand">
        <h1>Melodica</h1>
        <p>Learn languages through the music you already like.</p>
      </header>

      <section className="status" aria-live="polite">
        {connection.status === "checking" && (
          <p>Connecting to Rust core…</p>
        )}
        {connection.status === "connected" && (
          <p>
            Connected to{" "}
            <code>
              {connection.info.name} v{connection.info.version}
            </code>
          </p>
        )}
        {connection.status === "error" && (
          <p className="error">
            Rust core unreachable. Run via <code>npm run tauri:dev</code>.
            <br />
            <span>{connection.message}</span>
          </p>
        )}
      </section>

      <section className="upload">
        <button
          type="button"
          disabled={busy || connection.status !== "connected"}
          onClick={onUploadClick}
        >
          {busy ? "Adding…" : "Upload music file"}
        </button>
        {processingCount > 0 && (
          <p className="muted">
            Processing {processingCount} track
            {processingCount === 1 ? "" : "s"} in the background (lyrics +
            language). You can keep using the app.
          </p>
        )}
        {uploadError && <p className="error">{uploadError}</p>}
        {playbackError && <p className="error">{playbackError}</p>}
      </section>

      <section className="library">
        <h2>Library</h2>
        {tracks.length === 0 ? (
          <p className="muted">No tracks yet. Upload a music file to begin.</p>
        ) : (
          <ul className="track-list">
            {tracks.map((track) => {
              const open = openTrackId === track.id;
              const lyrics = lyricsByTrack[track.id];
              const isCurrent = playback.trackId === track.id;
              const isProcessing = processingIds.has(track.id);
              const durationMs =
                (isCurrent && playback.durationMs > 0
                  ? playback.durationMs
                  : track.durationMs) ?? 0;
              const positionMs =
                scrub?.trackId === track.id
                  ? scrub.ms
                  : isCurrent
                    ? playback.positionMs
                    : 0;
              const playing = isCurrent && playback.playing;

              return (
                <li key={track.id} className="track-item">
                  <div className="track-row">
                    <div className="track-meta">
                      <strong>{track.title}</strong>
                      {track.artist && (
                        <span className="muted"> — {track.artist}</span>
                      )}
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
                      className="lyrics-toggle"
                      onClick={() => onToggleLyrics(track.id)}
                    >
                      {open ? "Hide lyrics" : "View lyrics"}
                    </button>
                  </div>

                  <div className="player-row">
                    <button
                      type="button"
                      className="play-toggle"
                      disabled={connection.status !== "connected"}
                      onClick={() => onPlayPause(track)}
                      aria-label={playing ? "Pause" : "Play"}
                    >
                      {playing ? "Pause" : "Play"}
                    </button>
                    <div className="seek-wrap">
                      <input
                        type="range"
                        className="seek"
                        min={0}
                        max={Math.max(durationMs, 1)}
                        step={100}
                        value={Math.min(positionMs, Math.max(durationMs, 1))}
                        disabled={
                          connection.status !== "connected" || durationMs <= 0
                        }
                        aria-label={`Seek ${track.title}`}
                        onPointerDown={() => {
                          seekingRef.current = true;
                        }}
                        onChange={(e) => {
                          setScrub({
                            trackId: track.id,
                            ms: Number(e.target.value),
                          });
                        }}
                        onPointerUp={(e) => {
                          const value = Number(
                            (e.target as HTMLInputElement).value,
                          );
                          void onSeekCommit(track, value);
                        }}
                        onPointerCancel={() => {
                          seekingRef.current = false;
                          setScrub(null);
                        }}
                        onKeyUp={(e) => {
                          const value = Number(
                            (e.target as HTMLInputElement).value,
                          );
                          void onSeekCommit(track, value);
                        }}
                      />
                      <div className="seek-times" aria-hidden="true">
                        <span>{formatTime(positionMs)}</span>
                        <span>{formatTime(durationMs)}</span>
                      </div>
                    </div>
                  </div>

                  {open && (
                    <div className="lyrics-panel">
                      {isProcessing && (
                        <p className="muted">
                          Still extracting lyrics in the background…
                        </p>
                      )}
                      {lyrics === "loading" && <p>Loading lyrics…</p>}
                      {lyrics === "error" && (
                        <p className="error">Could not load lyrics.</p>
                      )}
                      {Array.isArray(lyrics) && lyrics.length === 0 && (
                        <p className="muted">
                          No lyrics yet — ensure the Melodica sidecar is running
                          for transcription (<code>npm run sidecar:dev</code>).
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
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
