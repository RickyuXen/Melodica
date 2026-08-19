import { useEffect, useRef, useState } from "react";
import { EditTrackPicker } from "./components/EditTrackPicker";
import { Header, type AppTab } from "./components/Header";
import { Settings } from "./components/Settings";
import { TrackItem } from "./components/TrackItem";
import type { TrackSearchState } from "./components/LyricsEditor";
import { errorMessage } from "./lib/format";
import { applyTheme, getStoredTheme, setStoredTheme, type Theme } from "./lib/theme";
import {
  getAppInfo,
  getLyrics,
  listTracks,
  onLyricsSearchFailed,
  onLyricsSearchFinished,
  onPipelineFailed,
  onPipelineFinished,
  pickAudioFile,
  playbackPlay,
  playbackSeek,
  playbackStatus,
  playbackToggle,
  processLyrics,
  processUpload,
  searchLyrics,
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
type SearchCache = Record<number, TrackSearchState>;

const emptyPlayback: PlaybackStatus = {
  trackId: null,
  playing: false,
  positionMs: 0,
  durationMs: 0,
};

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
  const [connection, setConnection] = useState<ConnectionState>({
    status: "checking",
  });
  const [tracks, setTracks] = useState<Track[]>([]);
  const [lyricsByTrack, setLyricsByTrack] = useState<LyricsCache>({});
  const [openTrackId, setOpenTrackId] = useState<number | null>(null);
  const [selectedEditTrackId, setSelectedEditTrackId] = useState<number | null>(
    null,
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [searchByTrack, setSearchByTrack] = useState<SearchCache>({});
  const [playback, setPlayback] = useState<PlaybackStatus>(emptyPlayback);
  const [scrub, setScrub] = useState<{ trackId: number; ms: number } | null>(
    null,
  );
  const seekingRef = useRef(false);

  const connected = connection.status === "connected";

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function onThemeChange(next: Theme) {
    setTheme(next);
    setStoredTheme(next);
  }

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

  function applySearchResult(
    trackId: number,
    query: string | null,
    matches: TrackSearchState["matches"],
    error: string | null,
  ) {
    const activeQuery = query?.trim() ?? "";
    setSearchByTrack((prev) => {
      const current = prev[trackId];
      if (current?.activeQuery !== activeQuery) return prev;
      return {
        ...prev,
        [trackId]: {
          activeQuery,
          searching: false,
          matches,
          error,
        },
      };
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
    let unlistenSearchFinished: (() => void) | undefined;
    let unlistenSearchFailed: (() => void) | undefined;

    void (async () => {
      unlistenFinished = await onPipelineFinished((track) => {
        if (cancelled) return;
        markProcessingDone(track.id);
        upsertTrack(track);
        void getLyrics(track.id)
          .then((lines) => {
            if (cancelled) return;
            setLyricsByTrack((prev) => ({ ...prev, [track.id]: lines }));
          })
          .catch(() => {
            if (cancelled) return;
            setLyricsByTrack((prev) => ({ ...prev, [track.id]: "error" }));
          });
      });

      unlistenFailed = await onPipelineFailed((error) => {
        if (cancelled) return;
        markProcessingDone(error.trackId);
        setUploadError(error.message);
        void refreshTracks();
      });

      unlistenSearchFinished = await onLyricsSearchFinished((result) => {
        if (cancelled) return;
        applySearchResult(
          result.trackId,
          result.query,
          result.matches,
          null,
        );
      });

      unlistenSearchFailed = await onLyricsSearchFailed((error) => {
        if (cancelled) return;
        applySearchResult(error.trackId, error.query, [], error.message);
      });
    })();

    return () => {
      cancelled = true;
      unlistenFinished?.();
      unlistenFailed?.();
      unlistenSearchFinished?.();
      unlistenSearchFailed?.();
    };
  }, [connected]);

  // Clear edit selection if the track was removed from the library.
  useEffect(() => {
    if (selectedEditTrackId == null) return;
    if (tracks.some((t) => t.id === selectedEditTrackId)) return;
    setSelectedEditTrackId(null);
  }, [tracks, selectedEditTrackId]);

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

      await processUpload(path);
      setOpenTrackId(null);
      await refreshTracks();
      setActiveTab("home");
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

  async function onSelectEditTrack(trackId: number) {
    setSelectedEditTrackId(trackId);

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

  async function onRequestSearch(trackId: number, query: string) {
    const activeQuery = query.trim();
    setSearchByTrack((prev) => ({
      ...prev,
      [trackId]: {
        activeQuery,
        searching: true,
        matches: prev[trackId]?.matches ?? [],
        error: null,
      },
    }));

    try {
      await searchLyrics(trackId, activeQuery || null);
    } catch (err: unknown) {
      applySearchResult(
        trackId,
        activeQuery,
        [],
        err instanceof Error ? err.message : "Could not start lyrics search.",
      );
    }
  }

  async function onProcessLyrics(
    trackId: number,
    pasted: string,
    lrclibId: number | null,
  ) {
    setUploadError(null);
    setProcessingIds((prev) => new Set(prev).add(trackId));
    try {
      await processLyrics(trackId, pasted, lrclibId);
    } catch (err: unknown) {
      markProcessingDone(trackId);
      setUploadError(errorMessage(err, "Could not process lyrics"));
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
  const searchingIds = new Set(
    Object.entries(searchByTrack)
      .filter(([, state]) => state.searching)
      .map(([id]) => Number(id)),
  );

  function renderTrackItem(track: Track, mode: "library" | "edit") {
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
        mode={mode}
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
        searchState={searchByTrack[track.id]}
        onRequestSearch={(query) => void onRequestSearch(track.id, query)}
        onProcessLyrics={(pasted, lrclibId) =>
          void onProcessLyrics(track.id, pasted, lrclibId)
        }
      />
    );
  }

  function renderTrackList() {
    if (tracks.length === 0) {
      return (
        <p className="muted">No tracks yet. Upload a music file to begin.</p>
      );
    }

    return (
      <ul className="track-list">
        {tracks.map((track) => renderTrackItem(track, "library"))}
      </ul>
    );
  }

  function renderEditTab() {
    if (tracks.length === 0) {
      return (
        <p className="muted">No tracks to edit yet. Upload a music file first.</p>
      );
    }

    const selectedTrack =
      selectedEditTrackId != null
        ? tracks.find((t) => t.id === selectedEditTrackId)
        : undefined;

    return (
      <>
        <EditTrackPicker
          tracks={tracks}
          selectedId={selectedEditTrackId}
          processingIds={processingIds}
          searchingIds={searchingIds}
          onSelect={(trackId) => void onSelectEditTrack(trackId)}
        />
        {selectedTrack && (
          <div className="edit-detail">
            <ul className="track-list">
              {renderTrackItem(selectedTrack, "edit")}
            </ul>
          </div>
        )}
      </>
    );
  }

  return (
    <main className="shell">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />

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

      {(uploadError || playbackError) && (
        <section className="panel errors" aria-live="polite">
          {uploadError && <p className="error">{uploadError}</p>}
          {playbackError && <p className="error">{playbackError}</p>}
        </section>
      )}

      {activeTab === "home" && (
        <section className="panel library">
          <h2>Library</h2>
          {renderTrackList()}
        </section>
      )}

      {activeTab === "upload" && (
        <section className="panel upload">
          <h2>Upload music</h2>
          <p className="muted upload-desc">
            Add audio files to your library. Supported formats include MP3,
            FLAC, WAV, OGG, M4A, and AAC.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !connected}
            onClick={onUploadClick}
          >
            {busy ? "Adding…" : "Choose music file"}
          </button>
          {processingCount > 0 && (
            <p className="muted">
              Processing {processingCount} track
              {processingCount === 1 ? "" : "s"} in the background. You can keep
              using the app.
            </p>
          )}
        </section>
      )}

      {activeTab === "edit" && (
        <section className="panel edit">
          <h2>Edit tracks</h2>
          <p className="muted edit-desc">
            Find, match, or paste lyrics for each track, then process to
            extract and sync them.
          </p>
          {renderEditTab()}
        </section>
      )}

      {activeTab === "settings" && (
        <section className="panel settings">
          <h2>Settings</h2>
          <p className="muted settings-desc">
            Personalize how Melodica looks while you study.
          </p>
          <Settings theme={theme} onThemeChange={onThemeChange} />
        </section>
      )}
    </main>
  );
}

export default App;
