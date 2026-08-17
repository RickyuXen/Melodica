import { useEffect, useState } from "react";
import {
  getAppInfo,
  getLyrics,
  listTracks,
  pickAudioFile,
  processUpload,
  type AppInfo,
  type LyricLine,
  type Track,
} from "./lib/tauri";
import "./App.css";

type ConnectionState =
  | { status: "checking" }
  | { status: "connected"; info: AppInfo }
  | { status: "error"; message: string };

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
  const [busy, setBusy] = useState(false);

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

  async function onUploadClick() {
    setBusy(true);
    setUploadError(null);

    try {
      const path = await pickAudioFile();
      if (!path) return;

      await processUpload(path);
      setLyricsByTrack({});
      setOpenTrackId(null);
      await refreshTracks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setUploadError(message);
      // Track may already be saved even if ASR failed — refresh the library.
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
          {busy ? "Processing…" : "Upload music file"}
        </button>
        {busy && (
          <p className="muted">
            Saving track and extracting lyrics (embedded tags or local
            transcription). First transcription may download a Whisper model.
          </p>
        )}
        {uploadError && <p className="error">{uploadError}</p>}
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

              return (
                <li key={track.id} className="track-item">
                  <div className="track-row">
                    <div className="track-meta">
                      <strong>{track.title}</strong>
                      {track.artist && (
                        <span className="muted"> — {track.artist}</span>
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

                  {open && (
                    <div className="lyrics-panel">
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
