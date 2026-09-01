import { Columns2, Maximize2, Minimize2 } from "lucide-react";
import type { PaneMode } from "../lib/trackList";

type TrackListToolbarProps = {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  paneMode: PaneMode;
  onPaneModeChange: (mode: PaneMode) => void;
};

export function TrackListToolbar({
  searchQuery,
  onSearchChange,
  paneMode,
  onPaneModeChange,
}: TrackListToolbarProps) {
  return (
    <div className="track-list-toolbar">
      <input
        type="search"
        className="track-list-search"
        placeholder="Search songs…"
        aria-label="Search songs"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <div className="track-list-pane-actions" role="group" aria-label="Pane layout">
        <button
          type="button"
          className={`track-list-pane-btn${paneMode === "list-only" ? " is-active" : ""}`}
          aria-label="Expand song list"
          aria-pressed={paneMode === "list-only"}
          title="Expand song list"
          onClick={() => onPaneModeChange("list-only")}
        >
          <Maximize2 size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={`track-list-pane-btn${paneMode === "lyrics-only" ? " is-active" : ""}`}
          aria-label="Show lyrics only"
          aria-pressed={paneMode === "lyrics-only"}
          title="Show lyrics only"
          onClick={() => onPaneModeChange("lyrics-only")}
        >
          <Minimize2 size={14} aria-hidden />
        </button>
        {paneMode !== "split" && (
          <button
            type="button"
            className="track-list-pane-btn"
            aria-label="Restore split view"
            title="Restore split view"
            onClick={() => onPaneModeChange("split")}
          >
            <Columns2 size={14} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
