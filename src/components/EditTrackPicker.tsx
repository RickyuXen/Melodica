import type { Track } from "../lib/tauri";
import { TrackListHeader, TrackListRow } from "./TrackListRow";

type EditTrackPickerProps = {
  tracks: Track[];
  selectedId: number | null;
  processingIds: Set<number>;
  searchingIds: Set<number>;
  onSelect: (trackId: number) => void;
};

export function EditTrackPicker({
  tracks,
  selectedId,
  processingIds,
  searchingIds,
  onSelect,
}: EditTrackPickerProps) {
  return (
    <>
      <TrackListHeader />
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
    </>
  );
}
