import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Track } from "../lib/tauri";
import type { PaneMode, SortDir, SortKey } from "../lib/trackList";
import { TrackListHeader, TrackListRow } from "./TrackListRow";
import { TrackListToolbar } from "./TrackListToolbar";

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

function optionId(trackId: number): string {
  return `track-option-${trackId}`;
}

function isListNavKey(key: string): boolean {
  return key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End";
}

type TrackListProps = {
  tracks: Track[];
  totalCount: number;
  selectedId: number | null;
  processingIds: Set<number>;
  sortKey: SortKey;
  sortDir: SortDir;
  searchQuery: string;
  paneMode: PaneMode;
  ariaLabel: string;
  /** Extra class on the list (e.g. library-track-list). */
  listClassName?: string;
  playingTrackId?: number | null;
  searchingIds?: Set<number>;
  /** When set, processing rows show phase-specific labels. */
  pipelinePhaseByTrack?: Record<number, string>;
  onSearchChange: (query: string) => void;
  onPaneModeChange: (mode: PaneMode) => void;
  onSort: (key: SortKey) => void;
  onSelect: (trackId: number) => void;
};

export function TrackList({
  tracks,
  totalCount,
  selectedId,
  processingIds,
  sortKey,
  sortDir,
  searchQuery,
  paneMode,
  ariaLabel,
  listClassName,
  playingTrackId = null,
  searchingIds,
  pipelinePhaseByTrack,
  onSearchChange,
  onPaneModeChange,
  onSort,
  onSelect,
}: TrackListProps) {
  const typeaheadRef = useRef({ buffer: "", timer: 0 as number | undefined });
  const [activeId, setActiveId] = useState<number | null>(selectedId);

  useEffect(() => {
    setActiveId(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (tracks.length === 0) {
      setActiveId(null);
      return;
    }
    if (activeId != null && tracks.some((t) => t.id === activeId)) return;
    setActiveId(selectedId ?? tracks[0]?.id ?? null);
  }, [tracks, activeId, selectedId]);

  const focusOption = useCallback((trackId: number) => {
    window.requestAnimationFrame(() => {
      document.getElementById(optionId(trackId))?.focus();
    });
  }, []);

  const moveToIndex = useCallback(
    (index: number) => {
      const track = tracks[index];
      if (!track) return;
      setActiveId(track.id);
      onSelect(track.id);
      focusOption(track.id);
    },
    [tracks, onSelect, focusOption],
  );

  const handleNavKey = useCallback(
    (event: KeyboardEvent) => {
      if (tracks.length === 0) return false;

      const currentIndex =
        activeId != null ? tracks.findIndex((t) => t.id === activeId) : -1;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveToIndex(currentIndex < 0 ? 0 : Math.min(tracks.length - 1, currentIndex + 1));
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveToIndex(
          currentIndex < 0 ? tracks.length - 1 : Math.max(0, currentIndex - 1),
        );
        return true;
      }
      if (event.key === "Home") {
        event.preventDefault();
        moveToIndex(0);
        return true;
      }
      if (event.key === "End") {
        event.preventDefault();
        moveToIndex(tracks.length - 1);
        return true;
      }

      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const state = typeaheadRef.current;
        window.clearTimeout(state.timer);
        state.buffer += event.key.toLowerCase();
        state.timer = window.setTimeout(() => {
          state.buffer = "";
        }, 500);
        const matchIndex = tracks.findIndex((t) =>
          t.title.toLowerCase().startsWith(state.buffer),
        );
        if (matchIndex >= 0) {
          event.preventDefault();
          moveToIndex(matchIndex);
          return true;
        }
      }

      return false;
    },
    [tracks, activeId, moveToIndex],
  );

  if (totalCount === 0) {
    return (
      <p className="muted library-empty">No tracks yet. Upload music files to begin.</p>
    );
  }

  const listClasses = ["edit-track-list", listClassName].filter(Boolean).join(" ");
  const activeDescendant =
    activeId != null ? optionId(activeId) : undefined;

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
        <ul
          className={listClasses}
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={activeDescendant}
          tabIndex={-1}
          onKeyDown={(event) => {
            handleNavKey(event);
          }}
        >
          {tracks.map((track, index) => {
            const isProcessing = processingIds.has(track.id);
            const isSearching = searchingIds?.has(track.id) ?? false;
            const status = pipelinePhaseByTrack
              ? phaseLabel(pipelinePhaseByTrack[track.id])
              : "Processing…";
            const isActive = activeId === track.id;
            const isTabStop =
              isActive || (activeId == null && index === 0);

            return (
              <li key={track.id} role="presentation">
                <TrackListRow
                  id={optionId(track.id)}
                  title={track.title}
                  artist={track.artist}
                  languageCode={track.languageCode}
                  status={status}
                  isSelected={selectedId === track.id}
                  isPlaying={playingTrackId === track.id}
                  isSearching={isSearching}
                  isProcessing={isProcessing}
                  tabIndex={isTabStop ? 0 : -1}
                  onClick={() => {
                    setActiveId(track.id);
                    onSelect(track.id);
                  }}
                  onKeyDown={(event) => {
                    if (isListNavKey(event.key) || event.key.length === 1) {
                      handleNavKey(event);
                    }
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
