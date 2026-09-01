import type { Track } from "../lib/tauri";
import type { PaneMode, SortDir, SortKey } from "../lib/trackList";
import { TrackListHeader, TrackListRow } from "./TrackListRow";
import { TrackListToolbar } from "./TrackListToolbar";

type EditTrackPickerProps = {
  tracks: Track[];
  totalCount: number;
  selectedId: number | null;
  processingIds: Set<number>;
  searchingIds: Set<number>;
  sortKey: SortKey;
  sortDir: SortDir;
  searchQuery: string;
  paneMode: PaneMode;
  onSearchChange: (query: string) => void;
  onPaneModeChange: (mode: PaneMode) => void;
  onSort: (key: SortKey) => void;
  onSelect: (trackId: number) => void;
};

export function EditTrackPicker({
  tracks,
  totalCount,
  selectedId,
  processingIds,
  searchingIds,
  sortKey,
  sortDir,
  searchQuery,
  paneMode,
  onSearchChange,
  onPaneModeChange,
  onSort,
  onSelect,
}: EditTrackPickerProps) {
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
        <ul className="edit-track-list" role="listbox" aria-label="Tracks to edit">
          {tracks.map((track) => {
            const isProcessing = processingIds.has(track.id);
            const isSearching = searchingIds.has(track.id);

            return (
              <li key={track.id} role="presentation">
                <TrackListRow
                  title={track.title}
                  artist={track.artist}
                  languageCode={track.languageCode}
                  isSelected={selectedId === track.id}
                  isSearching={isSearching}
                  isProcessing={isProcessing}
                  status="Processing…"
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
