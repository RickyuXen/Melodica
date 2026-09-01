import type { Track } from "../lib/tauri";
import type { TrackSearchState } from "./LyricsEditor";
import { paneModeClass } from "../lib/trackList";
import { useTrackListControls } from "../hooks/useTrackListControls";
import { EditTrackPicker } from "./EditTrackPicker";
import { TrackItem } from "./TrackItem";
import type { LyricLine } from "../lib/tauri";

type EditViewProps = {
  tracks: Track[];
  selectedEditTrackId: number | null;
  processingIds: Set<number>;
  searchingIds: Set<number>;
  lyricsByTrack: Record<number, LyricLine[] | "loading" | "error" | undefined>;
  searchByTrack: Record<number, TrackSearchState | undefined>;
  detectingLanguageIds: Set<number>;
  languagePreviewWarningByTrack: Record<number, string | null>;
  onSelectEditTrack: (trackId: number) => void;
  onRequestSearch: (trackId: number, query: string) => void;
  onProcessLyrics: (
    trackId: number,
    pasted: string,
    lrclibId: number | null,
  ) => void;
  onSetLanguage: (
    trackId: number,
    languageCode: string | null,
    lrclibId: number | null,
  ) => void;
  onPreviewLanguage: (trackId: number, lrclibId: number | null) => void;
};

export function EditView({
  tracks,
  selectedEditTrackId,
  processingIds,
  searchingIds,
  lyricsByTrack,
  searchByTrack,
  detectingLanguageIds,
  languagePreviewWarningByTrack,
  onSelectEditTrack,
  onRequestSearch,
  onProcessLyrics,
  onSetLanguage,
  onPreviewLanguage,
}: EditViewProps) {
  const {
    searchQuery,
    setSearchQuery,
    sortKey,
    sortDir,
    paneMode,
    setPaneMode,
    displayTracks,
    toggleSort,
  } = useTrackListControls(tracks);

  const selectedTrack =
    selectedEditTrackId != null
      ? tracks.find((t) => t.id === selectedEditTrackId)
      : undefined;

  return (
    <div className={paneModeClass("edit-split", paneMode)}>
      <div className="edit-split-picker track-list-pane">
        <h3 className="edit-split-heading">Tracks</h3>
        <EditTrackPicker
          tracks={displayTracks}
          totalCount={tracks.length}
          selectedId={selectedEditTrackId}
          processingIds={processingIds}
          searchingIds={searchingIds}
          sortKey={sortKey}
          sortDir={sortDir}
          searchQuery={searchQuery}
          paneMode={paneMode}
          onSearchChange={setSearchQuery}
          onPaneModeChange={setPaneMode}
          onSort={toggleSort}
          onSelect={onSelectEditTrack}
        />
      </div>
      <div className="edit-split-editor">
        {selectedTrack ? (
          <TrackItem
            track={selectedTrack}
            lyrics={lyricsByTrack[selectedTrack.id]}
            isProcessing={processingIds.has(selectedTrack.id)}
            searchState={searchByTrack[selectedTrack.id]}
            onRequestSearch={(query) => onRequestSearch(selectedTrack.id, query)}
            onProcessLyrics={(pasted, lrclibId) =>
              onProcessLyrics(selectedTrack.id, pasted, lrclibId)
            }
            onSetLanguage={(languageCode, lrclibId) =>
              onSetLanguage(selectedTrack.id, languageCode, lrclibId)
            }
            onPreviewLanguage={(lrclibId) =>
              onPreviewLanguage(selectedTrack.id, lrclibId)
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
