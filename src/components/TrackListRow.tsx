import { ChevronDown, ChevronUp } from "lucide-react";
import { languageLabel } from "../lib/format";
import type { SortDir, SortKey } from "../lib/trackList";

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

type TrackListHeaderProps = {
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
};

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "language", label: "Language" },
];

function ariaSortValue(
  key: SortKey,
  sortKey: SortKey,
  sortDir: SortDir,
): "ascending" | "descending" | "none" {
  if (key !== sortKey) return "none";
  return sortDir === "asc" ? "ascending" : "descending";
}

export function TrackListHeader({ sortKey, sortDir, onSort }: TrackListHeaderProps) {
  return (
    <div className="track-list-header" role="row">
      {COLUMNS.map(({ key, label }) => {
        const isActive = sortKey === key;
        const SortIcon = sortDir === "asc" ? ChevronUp : ChevronDown;

        return (
          <button
            key={key}
            type="button"
            role="columnheader"
            className={`track-list-header-cell track-list-sort-btn${isActive ? " is-active" : ""}`}
            aria-sort={ariaSortValue(key, sortKey, sortDir)}
            onClick={() => onSort(key)}
          >
            <span>{label}</span>
            {isActive && <SortIcon size={12} aria-hidden className="track-list-sort-icon" />}
          </button>
        );
      })}
    </div>
  );
}
