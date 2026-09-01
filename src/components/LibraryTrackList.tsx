import type { Track } from "../lib/tauri";
import { TrackListHeader, TrackListRow } from "./TrackListRow";

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
  openTrackId: number | null;
  playingTrackId: number | null;
  processingIds: Set<number>;
  pipelinePhaseByTrack: Record<number, string>;
  onSelect: (trackId: number) => void;
};

export function LibraryTrackList({
  tracks,
  openTrackId,
  playingTrackId,
  processingIds,
  pipelinePhaseByTrack,
  onSelect,
}: LibraryTrackListProps) {
  if (tracks.length === 0) {
    return (
      <p className="muted library-empty">No tracks yet. Upload music files to begin.</p>
    );
  }

  return (
    <>
      <TrackListHeader />
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
    </>
  );
}
