import { useEffect, useRef, useState } from "react";
import { EditTrackPicker } from "./components/EditTrackPicker";
import { HomeView } from "./components/HomeView";
import { NowPlayingBar } from "./components/NowPlayingBar";
import { Settings } from "./components/Settings";
import { Sidebar, type AppTab } from "./components/Sidebar";
import { TrackItem } from "./components/TrackItem";
import type { TrackSearchState } from "./components/LyricsEditor";
import { errorMessage } from "./lib/format";
import { applyTheme, getStoredTheme, setStoredTheme, type Theme } from "./lib/theme";
import {
  getStoredTranslationLanguage,
  setStoredTranslationLanguage,
  type TranslationLanguage,
} from "./lib/translationLanguage";
import {
  getAppInfo,
  getLyrics,
  listTracks,
  onLanguagePreviewFailed,
  onLanguagePreviewFinished,
  onLyricsSearchFailed,
  onLyricsSearchFinished,
  onPipelineFailed,
  onPipelineFinished,
  onPipelinePhase,
  pickAudioFiles,
  playbackPlay,
  playbackSeek,
  playbackStatus,
  playbackToggle,
  previewLrclibLanguage,
  processLyrics,
  processUploads,
  resetDatabase,
  searchLyrics,
  setTrackLanguage,
  setVolume,
  playbackPlayNext,
  playbackPlayPrevious,
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
  const [translationLanguage, setTranslationLanguage] =
    useState<TranslationLanguage>(() => getStoredTranslationLanguage());
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
  const [pipelinePhaseByTrack, setPipelinePhaseByTrack] = useState<
    Record<number, string>
  >({});
  const [detectingLanguageIds, setDetectingLanguageIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [languagePreviewWarningByTrack, setLanguagePreviewWarningByTrack] =
    useState<Record<number, string | null>>({});
  const [searchByTrack, setSearchByTrack] = useState<SearchCache>({});
  const [playback, setPlayback] = useState<PlaybackStatus>(emptyPlayback);
  const [volume, setVolumeState] = useState(1);
  const [scrub, setScrub] = useState<{ trackId: number; ms: number } | null>(
    null,
  );
  const seekingRef = useRef(false);

  const connected = connection.status === "connected";

  const currentTrack =
    playback.trackId != null
      ? tracks.find((t) => t.id === playback.trackId)
      : undefined;

  const playerDurationMs =
    currentTrack && playback.durationMs > 0
      ? playback.durationMs
      : (currentTrack?.durationMs ?? 0);

  const playerPositionMs =
    scrub?.trackId === playback.trackId
      ? scrub.ms
      : playback.positionMs;

  const openTrackIsCurrent = openTrackId != null && openTrackId === playback.trackId;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function onThemeChange(next: Theme) {
    setTheme(next);
    setStoredTheme(next);
  }

  function onTranslationLanguageChange(next: TranslationLanguage) {
    setTranslationLanguage(next);
    setStoredTranslationLanguage(next);
  }

  async function onResetDatabase() {
    await resetDatabase();
    setTracks([]);
    setLyricsByTrack({});
    setOpenTrackId(null);
    setSelectedEditTrackId(null);
    setUploadError(null);
    setPlaybackError(null);
    setProcessingIds(new Set());
    setPipelinePhaseByTrack({});
    setDetectingLanguageIds(new Set());
    setLanguagePreviewWarningByTrack({});
    setSearchByTrack({});
    setPlayback(emptyPlayback);
    setScrub(null);
    seekingRef.current = false;
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
    setPipelinePhaseByTrack((prev) => {
      if (!(trackId in prev)) return prev;
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
  }

  function markDetectingDone(trackId: number) {
    setDetectingLanguageIds((prev) => {
      const next = new Set(prev);
      next.delete(trackId);
      return next;
    });
  }

  function applySearchResult(
    trackId: number,
    query: string | null,
    matches: TrackSearchState["matches"],
    preferredMatchId: number | null,
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
          preferredMatchId,
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
    if (status.trackId != null) {
      setOpenTrackId(status.trackId);
    }
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

  async function loadLyrics(trackId: number) {
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
    let unlistenPhase: (() => void) | undefined;
    let unlistenSearchFinished: (() => void) | undefined;
    let unlistenSearchFailed: (() => void) | undefined;
    let unlistenPreviewFinished: (() => void) | undefined;
    let unlistenPreviewFailed: (() => void) | undefined;

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
        if (error.trackId > 0) {
          markProcessingDone(error.trackId);
        }
        setUploadError(error.message);
        void refreshTracks();
      });

      unlistenPhase = await onPipelinePhase((event) => {
        if (cancelled || event.trackId <= 0) return;
        if (event.phase === "ready") {
          setPipelinePhaseByTrack((prev) => ({
            ...prev,
            [event.trackId]: event.phase,
          }));
          return;
        }
        if (event.phase === "failed") {
          markProcessingDone(event.trackId);
          return;
        }
        setProcessingIds((prev) => new Set(prev).add(event.trackId));
        setPipelinePhaseByTrack((prev) => ({
          ...prev,
          [event.trackId]: event.phase,
        }));
      });

      unlistenSearchFinished = await onLyricsSearchFinished((result) => {
        if (cancelled) return;
        applySearchResult(
          result.trackId,
          result.query,
          result.matches,
          result.preferredMatchId,
          null,
        );
      });

      unlistenSearchFailed = await onLyricsSearchFailed((error) => {
        if (cancelled) return;
        applySearchResult(error.trackId, error.query, [], null, error.message);
      });

      unlistenPreviewFinished = await onLanguagePreviewFinished((result) => {
        if (cancelled) return;
        markDetectingDone(result.track.id);
        upsertTrack(result.track);
        setLanguagePreviewWarningByTrack((prev) => ({
          ...prev,
          [result.track.id]: result.warning,
        }));
      });

      unlistenPreviewFailed = await onLanguagePreviewFailed((error) => {
        if (cancelled) return;
        markDetectingDone(error.trackId);
        setLanguagePreviewWarningByTrack((prev) => ({
          ...prev,
          [error.trackId]: error.message,
        }));
        void refreshTracks();
      });
    })();

    return () => {
      cancelled = true;
      unlistenFinished?.();
      unlistenFailed?.();
      unlistenPhase?.();
      unlistenSearchFinished?.();
      unlistenSearchFailed?.();
      unlistenPreviewFinished?.();
      unlistenPreviewFailed?.();
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
      const paths = await pickAudioFiles();
      if (paths.length === 0) return;

      const uploaded = await processUploads(paths);
      setProcessingIds((prev) => {
        const next = new Set(prev);
        for (const track of uploaded) next.add(track.id);
        return next;
      });
      setPipelinePhaseByTrack((prev) => {
        const next = { ...prev };
        for (const track of uploaded) {
          next[track.id] = prev[track.id] ?? "importing";
        }
        return next;
      });
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
    await loadLyrics(trackId);
  }

  async function onSelectLibraryTrack(trackId: number) {
    setOpenTrackId(trackId);
    setPlaybackError(null);
    void loadLyrics(trackId);
    try {
      applyPlayback(await playbackPlay(trackId));
    } catch (err: unknown) {
      setPlaybackError(errorMessage(err, "Playback failed"));
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
        preferredMatchId: prev[trackId]?.preferredMatchId ?? null,
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
        null,
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

  async function onSetLanguage(
    trackId: number,
    languageCode: string | null,
    lrclibId: number | null,
  ) {
    setUploadError(null);
    setLanguagePreviewWarningByTrack((prev) => ({ ...prev, [trackId]: null }));
    const isAuto = !languageCode?.trim();
    if (isAuto && lrclibId != null) {
      setDetectingLanguageIds((prev) => new Set(prev).add(trackId));
    }
    try {
      await setTrackLanguage(
        trackId,
        languageCode,
        isAuto ? lrclibId : null,
      );
    } catch (err: unknown) {
      markDetectingDone(trackId);
      setUploadError(errorMessage(err, "Could not update song language"));
    }
  }

  async function onPreviewLanguage(trackId: number, lrclibId: number | null) {
    setLanguagePreviewWarningByTrack((prev) => ({ ...prev, [trackId]: null }));
    setDetectingLanguageIds((prev) => new Set(prev).add(trackId));
    try {
      await previewLrclibLanguage(trackId, lrclibId);
    } catch (err: unknown) {
      markDetectingDone(trackId);
      setLanguagePreviewWarningByTrack((prev) => ({
        ...prev,
        [trackId]: errorMessage(err, "Could not detect language"),
      }));
    }
  }

  async function onPlayPause() {
    if (!currentTrack) return;
    setPlaybackError(null);
    try {
      const isCurrent = playback.trackId === currentTrack.id;
      const finished =
        isCurrent &&
        !playback.playing &&
        playback.durationMs > 0 &&
        playback.positionMs >= playback.durationMs;
      const status =
        isCurrent && !finished
          ? await playbackToggle()
          : await playbackPlay(currentTrack.id);
      applyPlayback(status);
    } catch (err: unknown) {
      setPlaybackError(errorMessage(err, "Playback failed"));
    }
  }

  async function onSeekCommit(valueMs: number) {
    if (!currentTrack) return;
    seekingRef.current = true;
    setPlaybackError(null);
    try {
      if (playback.trackId !== currentTrack.id) {
        await playbackPlay(currentTrack.id);
      }
      applyPlayback(await playbackSeek(valueMs));
    } catch (err: unknown) {
      setPlaybackError(errorMessage(err, "Seek failed"));
    } finally {
      seekingRef.current = false;
      setScrub(null);
    }
  }

  async function onSeekLine(ms: number) {
    if (openTrackId == null) return;
    seekingRef.current = true;
    setPlaybackError(null);
    try {
      if (playback.trackId !== openTrackId) {
        applyPlayback(await playbackPlay(openTrackId));
      }
      applyPlayback(await playbackSeek(ms));
    } catch (err: unknown) {
      setPlaybackError(errorMessage(err, "Seek failed"));
    } finally {
      seekingRef.current = false;
      setScrub(null);
    }
  }

  async function onVolumeChange(next: number) {
    const clamped = Math.min(1, Math.max(0, next));
    setVolumeState(clamped);
    if (!connected) return;
    try {
      await setVolume(clamped);
    } catch (err: unknown) {
      setPlaybackError(errorMessage(err, "Could not set volume"));
    }
  }

  async function onPlayNext() {
    setPlaybackError(null);
    try {
      applyPlayback(await playbackPlayNext());
      const nextId = (await playbackStatus()).trackId;
      if (nextId != null) void loadLyrics(nextId);
    } catch (err: unknown) {
      setPlaybackError(errorMessage(err, "Could not play next track"));
    }
  }

  async function onPlayPrevious() {
    setPlaybackError(null);
    try {
      applyPlayback(await playbackPlayPrevious());
      const prevId = (await playbackStatus()).trackId;
      if (prevId != null) void loadLyrics(prevId);
    } catch (err: unknown) {
      setPlaybackError(errorMessage(err, "Could not play previous track"));
    }
  }

  function onNowPlayingTrackClick() {
    if (playback.trackId == null) return;
    setActiveTab("home");
    setOpenTrackId(playback.trackId);
    void loadLyrics(playback.trackId);
  }

  const processingCount = processingIds.size;
  const searchingIds = new Set(
    Object.entries(searchByTrack)
      .filter(([, state]) => state.searching)
      .map(([id]) => Number(id)),
  );

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
      <div className="edit-split">
        <div className="edit-split-picker track-list-pane">
          <h3 className="edit-split-heading">Tracks</h3>
          <EditTrackPicker
            tracks={tracks}
            selectedId={selectedEditTrackId}
            processingIds={processingIds}
            searchingIds={searchingIds}
            onSelect={(trackId) => void onSelectEditTrack(trackId)}
          />
        </div>
        <div className="edit-split-editor">
          {selectedTrack ? (
            <TrackItem
              track={selectedTrack}
              lyrics={lyricsByTrack[selectedTrack.id]}
              isProcessing={processingIds.has(selectedTrack.id)}
              searchState={searchByTrack[selectedTrack.id]}
              onRequestSearch={(query) =>
                void onRequestSearch(selectedTrack.id, query)
              }
              onProcessLyrics={(pasted, lrclibId) =>
                void onProcessLyrics(selectedTrack.id, pasted, lrclibId)
              }
              onSetLanguage={(languageCode, lrclibId) =>
                void onSetLanguage(selectedTrack.id, languageCode, lrclibId)
              }
              onPreviewLanguage={(lrclibId) =>
                void onPreviewLanguage(selectedTrack.id, lrclibId)
              }
              isDetectingLanguage={detectingLanguageIds.has(selectedTrack.id)}
              languagePreviewWarning={
                languagePreviewWarningByTrack[selectedTrack.id] ?? null
              }
            />
          ) : (
            <p className="muted edit-empty">Select a track to edit its lyrics</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        connection={connection}
      />

      <div className="main-column">
        <div className="main-content">
          {(uploadError || playbackError) && (
            <section className="panel errors" aria-live="polite">
              {uploadError && <p className="error">{uploadError}</p>}
              {playbackError && <p className="error">{playbackError}</p>}
            </section>
          )}

          {activeTab === "home" && (
            <section className="panel library">
              <HomeView
                tracks={tracks}
                openTrackId={openTrackId}
                playingTrackId={playback.trackId}
                lyrics={openTrackId != null ? lyricsByTrack[openTrackId] : undefined}
                positionMs={openTrackIsCurrent ? playerPositionMs : 0}
                isCurrent={openTrackIsCurrent}
                processingIds={processingIds}
                pipelinePhaseByTrack={pipelinePhaseByTrack}
                onSelectTrack={(trackId) => void onSelectLibraryTrack(trackId)}
                onSeekLine={(ms) => void onSeekLine(ms)}
              />
            </section>
          )}

          {activeTab === "upload" && (
            <section className="panel upload">
              <h2>Upload music</h2>
              <p className="muted upload-desc">
                Add one or more audio files. Each upload runs lyrics + translation
                automatically. Supported formats include MP3, FLAC, WAV, OGG, M4A,
                and AAC.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !connected}
                onClick={onUploadClick}
              >
                {busy ? "Adding…" : "Choose music files"}
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
                Personalize appearance and translation preferences.
              </p>
              <Settings
                theme={theme}
                onThemeChange={onThemeChange}
                translationLanguage={translationLanguage}
                onTranslationLanguageChange={onTranslationLanguageChange}
                onResetDatabase={onResetDatabase}
                canResetDatabase={connected}
              />
            </section>
          )}
        </div>

        <NowPlayingBar
          track={currentTrack}
          playback={playback}
          volume={volume}
          positionMs={playerPositionMs}
          durationMs={playerDurationMs}
          canControl={connected}
          onPlayPause={() => void onPlayPause()}
          onPlayPrevious={() => void onPlayPrevious()}
          onPlayNext={() => void onPlayNext()}
          onScrub={(ms) => {
            if (playback.trackId != null) {
              setScrub({ trackId: playback.trackId, ms });
            }
          }}
          onSeekCommit={(ms) => void onSeekCommit(ms)}
          onSeekCancel={() => {
            seekingRef.current = false;
            setScrub(null);
          }}
          onSeekPointerDown={() => {
            seekingRef.current = true;
          }}
          onVolumeChange={onVolumeChange}
          onTrackClick={onNowPlayingTrackClick}
          hasTracks={tracks.length > 0}
        />
      </div>
    </div>
  );
}

export default App;
