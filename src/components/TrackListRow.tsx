import { languageLabel } from "../lib/format";

type TrackListRowProps = {
  title: string;
  artist: string | null;
  languageCode: string | null;
  status?: string | null;
  isSelected?: boolean;
  isPlaying?: boolean;
  isSearching?: boolean;
  isProcessing?: boolean;
  onClick: () => void;
};

export function TrackListRow({
  title,
  artist,
  languageCode,
  status,
  isSelected = false,
  isPlaying = false,
  isSearching = false,
  isProcessing = false,
  onClick,
}: TrackListRowProps) {
  const languageContent = isSearching
    ? "Searching…"
    : isProcessing && status
      ? status
      : languageCode
        ? languageLabel(languageCode)
        : "—";

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      aria-busy={isSearching || isProcessing}
      className={`edit-track-row${isSelected ? " is-selected" : ""}${isPlaying ? " is-playing" : ""}`}
      onClick={onClick}
    >
      <span className="track-row-cells">
        <span className="track-cell track-cell-title" title={title}>
          {title}
        </span>
        <span
          className="track-cell track-cell-artist muted"
          title={artist ?? undefined}
        >
          {artist ?? "—"}
        </span>
        <span
          className={`track-cell track-cell-lang${isSearching || isProcessing ? " is-status" : ""}`}
          title={languageContent}
        >
          {languageContent}
        </span>
      </span>
    </button>
  );
}

export function TrackListHeader() {
  return (
    <div className="track-list-header" aria-hidden="true">
      <span className="track-list-header-cell">Title</span>
      <span className="track-list-header-cell">Artist</span>
      <span className="track-list-header-cell">Language</span>
    </div>
  );
}
