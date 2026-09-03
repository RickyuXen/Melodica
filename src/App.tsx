import { useEffect, useMemo, useState } from "react";
import { EditView } from "./components/EditView";
import { HomeView } from "./components/HomeView";
import { NowPlayingBar } from "./components/NowPlayingBar";
import { Settings } from "./components/Settings";
import { Sidebar, type AppTab, type ConnectionState } from "./components/Sidebar";
import { useLibrarySession } from "./hooks/useLibrarySession";
import { usePipelineSession } from "./hooks/usePipelineSession";
import { usePlaybackSession } from "./hooks/usePlaybackSession";
import { errorMessage } from "./lib/format";
import { applyTheme, getStoredTheme, setStoredTheme, type Theme } from "./lib/theme";
import {
  getStoredTranslationLanguage,
  setStoredTranslationLanguage,
  type TranslationLanguage,
} from "./lib/translationLanguage";
import {
  getAppInfo,
  resetDatabase,
} from "./lib/tauri";
import "./App.css";

function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
  const [translationLanguage, setTranslationLanguage] =
    useState<TranslationLanguage>(() => getStoredTranslationLanguage());
  const [connection, setConnection] = useState<ConnectionState>({
    status: "checking",
  });

  const library = useLibrarySession();
  const connected = connection.status === "connected";

  const pipelineLibrary = useMemo(
    () => ({
      upsertTrack: library.upsertTrack,
      setLyricsForTrack: library.setLyricsForTrack,
      refreshTracks: library.refreshTracks,
      setOpenTrackId: library.setOpenTrackId,
    }),
    [
      library.upsertTrack,
      library.setLyricsForTrack,
      library.refreshTracks,
      library.setOpenTrackId,
    ],
  );

  const pipeline = usePipelineSession(connected, pipelineLibrary);

  const playback = usePlaybackSession(connected, {
    onDurationKnown: library.patchTrackDuration,
    onPlayingTrackChange: library.setOpenTrackId,
  });

  const currentTrack =
    playback.playback.trackId != null
      ? library.tracks.find((t) => t.id === playback.playback.trackId)
      : undefined;

  const playerDurationMs =
    currentTrack && playback.playback.durationMs > 0
      ? playback.playback.durationMs
      : (currentTrack?.durationMs ?? 0);

  const openTrackIsCurrent =
    library.openTrackId != null &&
    library.openTrackId === playback.playback.trackId;

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
    library.reset();
    pipeline.reset();
    playback.reset();
  }

  // Boot: reach Rust core, then load the library.
  useEffect(() => {
    let cancelled = false;

    getAppInfo()
      .then(async (info) => {
        if (cancelled) return;
        setConnection({ status: "connected", info });
        await library.refreshTracks();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once
  }, []);

  async function onSelectEditTrack(trackId: number) {
    library.setSelectedEditTrackId(trackId);
    await library.loadLyrics(trackId);
  }

  async function onSelectLibraryTrack(trackId: number) {
    library.setOpenTrackId(trackId);
    playback.setPlaybackError(null);
    void library.loadLyrics(trackId);
    await playback.playTrack(trackId);
  }

  function onNowPlayingTrackClick() {
    if (playback.playback.trackId == null) return;
    setActiveTab("home");
    library.setOpenTrackId(playback.playback.trackId);
    void library.loadLyrics(playback.playback.trackId);
  }

  function renderEditTab() {
    if (library.tracks.length === 0) {
      return (
        <p className="muted">No tracks to edit yet. Upload a music file first.</p>
      );
    }

    return (
      <EditView
        tracks={library.tracks}
        selectedEditTrackId={library.selectedEditTrackId}
        processingIds={pipeline.processingIds}
        searchingIds={pipeline.searchingIds}
        lyricsByTrack={library.lyricsByTrack}
        searchByTrack={pipeline.searchByTrack}
        detectingLanguageIds={pipeline.detectingLanguageIds}
        languagePreviewWarningByTrack={pipeline.languagePreviewWarningByTrack}
        onSelectEditTrack={(trackId) => void onSelectEditTrack(trackId)}
        onRequestSearch={(trackId, query) =>
          void pipeline.requestSearch(trackId, query)
        }
        onProcessLyrics={(trackId, pasted, lrclibId) =>
          void pipeline.processTrackLyrics(trackId, pasted, lrclibId)
        }
        onSetLanguage={(trackId, languageCode, lrclibId) =>
          void pipeline.setLanguage(trackId, languageCode, lrclibId)
        }
        onPreviewLanguage={(trackId, lrclibId) =>
          void pipeline.previewLanguage(trackId, lrclibId)
        }
      />
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
          {(pipeline.pipelineError || playback.playbackError) && (
            <section className="panel errors" aria-live="polite">
              {pipeline.pipelineError && (
                <p className="error">{pipeline.pipelineError}</p>
              )}
              {playback.playbackError && (
                <p className="error">{playback.playbackError}</p>
              )}
            </section>
          )}

          {activeTab === "home" && (
            <section className="panel library">
              <HomeView
                tracks={library.tracks}
                openTrackId={library.openTrackId}
                playingTrackId={playback.playback.trackId}
                lyrics={
                  library.openTrackId != null
                    ? library.lyricsByTrack[library.openTrackId]
                    : undefined
                }
                positionMs={
                  openTrackIsCurrent ? playback.displayPositionMs : 0
                }
                isCurrent={openTrackIsCurrent}
                processingIds={pipeline.processingIds}
                pipelinePhaseByTrack={pipeline.pipelinePhaseByTrack}
                onSelectTrack={(trackId) => void onSelectLibraryTrack(trackId)}
                onSeekLine={(ms) =>
                  void playback.seekLine(ms, library.openTrackId)
                }
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
                disabled={pipeline.busy || !connected}
                onClick={() =>
                  void pipeline.upload(() => setActiveTab("home"))
                }
              >
                {pipeline.busy ? "Adding…" : "Choose music files"}
              </button>
              {pipeline.processingCount > 0 && (
                <p className="muted">
                  Processing {pipeline.processingCount} track
                  {pipeline.processingCount === 1 ? "" : "s"} in the background.
                  You can keep using the app.
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
          playback={playback.playback}
          volume={playback.volume}
          positionMs={playback.displayPositionMs}
          durationMs={playerDurationMs}
          canControl={connected}
          onPlayPause={() => void playback.playPause(currentTrack)}
          onPlayPrevious={() => {
            void (async () => {
              const prevId = await playback.playPrevious();
              if (prevId != null) void library.loadLyrics(prevId);
            })();
          }}
          onPlayNext={() => {
            void (async () => {
              const nextId = await playback.playNext();
              if (nextId != null) void library.loadLyrics(nextId);
            })();
          }}
          onScrub={playback.beginScrub}
          onSeekCommit={(ms) => void playback.seekCommit(ms, currentTrack)}
          onSeekCancel={playback.cancelSeek}
          onSeekPointerDown={playback.pointerDownSeek}
          onVolumeChange={playback.changeVolume}
          onTrackClick={onNowPlayingTrackClick}
          hasTracks={library.tracks.length > 0}
        />
      </div>
    </div>
  );
}

export default App;
