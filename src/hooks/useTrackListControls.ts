import { useMemo, useState } from "react";
import type { Track } from "../lib/tauri";
import {
  DEFAULT_SORT,
  filterTracks,
  sortTracks,
  type PaneMode,
  type SortDir,
  type SortKey,
} from "../lib/trackList";

export function useTrackListControls(tracks: Track[]) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT.key);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT.dir);
  const [paneMode, setPaneMode] = useState<PaneMode>("split");

  const displayTracks = useMemo(
    () => sortTracks(filterTracks(tracks, searchQuery), sortKey, sortDir),
    [tracks, searchQuery, sortKey, sortDir],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return {
    searchQuery,
    setSearchQuery,
    sortKey,
    sortDir,
    paneMode,
    setPaneMode,
    displayTracks,
    toggleSort,
  };
}
