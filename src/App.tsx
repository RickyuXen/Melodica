import { useEffect, useRef, useState } from "react";
import { TrackItem } from "./components/TrackItem";
import { errorMessage } from "./lib/format";
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

type LyricsCache = Record<number, LyricLine[] | "loading" | "error">;

const emptyPlayback: PlaybackStatus = {
  trackId: null,
  playing: false,
  positionMs: 0,
  durationMs: 0,
};

function App() {
  const [connection, setConnection] = useState<ConnectionState>({
    status: "checking",
  });
  const [tracks, setTracks] = useState<Track[]>([]);
  const [lyricsByTrack, setLyricsByTrack] = useState<LyricsCache>({});
  const [openTrackId, setOpenTrackId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [playback, setPlayback] = useState<PlaybackStatus>(emptyPlayback);
  const [scrub, setScrub] = useState<{ trackId: number; ms: number } | null>(
    null,
  );
  const seekingRef = useRef(false);

  const connected = connection.status === "connected";

  async function refreshTracks() {
    setTracks(await listTracks());
  }

  function markProcessingDone(trackId: number) {
    setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(trackId);
      return next;
    });
  }

  function upsertTrack(track: Track) {
    setTracks((prev) => {
      const idx = prev.findIndex((t) => t.id === track.id);
      if (idx === -1) return [track, ...prev];
      const next = [...prev];
      next[idx] = track;
      return next;
    });
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

  // Boot: reach Rust core, then load the library.
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
          setConnection({
            status: "error",
            message: errorMessage(err, "Failed to reach Rust core"),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Pipeline events while connected.
  useEffect(() => {
    if (!connected) return;

    let cancelled = false;
    let unlistenFinished: (() => void) | undefined;
    let unlistenFailed: (() => void) | undefined;

    void (async () => {
      unlistenFinished = await onPipelineFinished((track) => {
        if (cancelled) return;
        markProcessingDone(track.id);
        upsertTrack(track);
        setLyricsByTrack((prev) => {
          const next = { ...prev };
          delete next[track.id];
          return next;
        });
      });

      unlistenFailed = await onPipelineFailed((error) => {
        if (cancelled) return;
        markProcessingDone(error.trackId);
        setUploadError(error.message);
        void refreshTracks();
      });
    })();

    return () => {
      cancelled = true;
      unlistenFinished?.();
      unlistenFailed?.();
    };
  }, [connected]);

  // Playback position poll.
  useEffect(() => {
    if (!connected) return;

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

    void poll();
    const id = window.setInterval(poll, 250);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [connected]);

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
      setUploadError(errorMessage(err, "Upload failed"));
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

    const cached = lyricsByTrack[trackId];
    if (cached && cached !== "error") return;

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
      setPlaybackError(errorMessage(err, "Playback failed"));
    }
  }

  async function onSeekCommit(track: Track, valueMs: number) {
    seekingRef.current = true;
    setPlaybackError(null);
    try {
      if (playback.trackId !== track.id) {
        await playbackPlay(track.id);
      }
      applyPlayback(await playbackSeek(valueMs));
    } catch (err: unknown) {
      setPlaybackError(errorMessage(err, "Seek failed"));
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

      <section className="panel status" aria-live="polite">
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

      <section className="panel upload">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !connected}
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

      <section className="panel library">
        <h2>Library</h2>
        {tracks.length === 0 ? (
          <p className="muted">No tracks yet. Upload a music file to begin.</p>
        ) : (
          <ul className="track-list">
            {tracks.map((track) => {
              const isCurrent = playback.trackId === track.id;
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

              return (
                <TrackItem
                  key={track.id}
                  track={track}
                  lyrics={lyricsByTrack[track.id]}
                  lyricsOpen={openTrackId === track.id}
                  isCurrent={isCurrent}
                  isProcessing={processingIds.has(track.id)}
                  playing={isCurrent && playback.playing}
                  positionMs={positionMs}
                  durationMs={durationMs}
                  canControl={connected}
                  onToggleLyrics={() => void onToggleLyrics(track.id)}
                  onPlayPause={() => void onPlayPause(track)}
                  onScrub={(ms) => setScrub({ trackId: track.id, ms })}
                  onSeekCommit={(ms) => void onSeekCommit(track, ms)}
                  onSeekCancel={() => {
                    seekingRef.current = false;
                    setScrub(null);
                  }}
                  onSeekPointerDown={() => {
                    seekingRef.current = true;
                  }}
                />
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

export default App;
