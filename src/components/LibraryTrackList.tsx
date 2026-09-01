import type { Track } from "../lib/tauri";
import type { SortDir, SortKey } from "../lib/trackList";
import { TrackListHeader, TrackListRow } from "./TrackListRow";
import { TrackListToolbar } from "./TrackListToolbar";
import type { PaneMode } from "../lib/trackList";

function phaseLabel(phase: string | null | undefined): string {
  switch (phase) {
    case "importing":
      return "Importing…";
    case "searching":
      return "Finding lyrics…";
    case "transcribing":
      return "Transcribing…";
    case "translating":
      return "Translating…";
    default:
      return "Processing…";
  }
}

type LibraryTrackListProps = {
  tracks: Track[];
  totalCount: number;
  openTrackId: number | null;
  playingTrackId: number | null;
  processingIds: Set<number>;
  pipelinePhaseByTrack: Record<number, string>;
  sortKey: SortKey;
  sortDir: SortDir;
  searchQuery: string;
  paneMode: PaneMode;
  onSearchChange: (query: string) => void;
  onPaneModeChange: (mode: PaneMode) => void;
  onSort: (key: SortKey) => void;
  onSelect: (trackId: number) => void;
};

export function LibraryTrackList({
  tracks,
  totalCount,
  openTrackId,
  playingTrackId,
  processingIds,
  pipelinePhaseByTrack,
  sortKey,
  sortDir,
  searchQuery,
  paneMode,
  onSearchChange,
  onPaneModeChange,
  onSort,
  onSelect,
}: LibraryTrackListProps) {
  if (totalCount === 0) {
    return (
      <p className="muted library-empty">No tracks yet. Upload music files to begin.</p>
    );
  }

  return (
    <div className="track-list-stack">
      <div className="track-list-sticky">
        <TrackListToolbar
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          paneMode={paneMode}
          onPaneModeChange={onPaneModeChange}
        />
        <TrackListHeader sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      </div>
      {tracks.length === 0 ? (
        <p className="muted library-empty">No matching songs.</p>
      ) : (
        <ul className="edit-track-list library-track-list" role="listbox" aria-label="Library">
          {tracks.map((track) => {
            const isProcessing = processingIds.has(track.id);

            return (
              <li key={track.id} role="presentation">
                <TrackListRow
                  title={track.title}
                  artist={track.artist}
                  languageCode={track.languageCode}
                  status={phaseLabel(pipelinePhaseByTrack[track.id])}
                  isSelected={openTrackId === track.id}
                  isPlaying={playingTrackId === track.id}
                  isProcessing={isProcessing}
                  onClick={() => onSelect(track.id)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
