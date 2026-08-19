import type { Track } from "../lib/tauri";
import { languageLabel } from "../lib/format";

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
    <ul className="edit-track-list" role="listbox" aria-label="Tracks to edit">
      {tracks.map((track) => {
        const isSelected = selectedId === track.id;
        const isProcessing = processingIds.has(track.id);
        const isSearching = searchingIds.has(track.id);

        return (
          <li key={track.id} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`edit-track-row${isSelected ? " is-selected" : ""}`}
              aria-busy={isSearching || isProcessing}
              onClick={() => onSelect(track.id)}
            >
              <span className="track-meta">
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
              </span>
              {isSearching && (
                <span
                  className="edit-track-bar"
                  role="progressbar"
                  aria-label="Searching lyrics"
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
