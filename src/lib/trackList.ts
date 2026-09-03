import type { Track } from "./tauri";
import { languageLabel } from "./format";

export type SortKey = "title" | "artist" | "language";
export type SortDir = "asc" | "desc";
export type PaneMode = "split" | "list-only" | "lyrics-only";

export const DEFAULT_SORT: { key: SortKey; dir: SortDir } = {
  key: "title",
  dir: "asc",
};

function trackLanguageLabel(code: string | null): string {
  return code ? languageLabel(code) : "";
}

function compareNullable(
  a: string | null,
  b: string | null,
  dir: SortDir,
): number {
  const aEmpty = !a;
  const bEmpty = !b;
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const cmp = a!.localeCompare(b!, undefined, { sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}

export function filterTracks(tracks: Track[], query: string): Track[] {
  const q = query.trim().toLowerCase();
  if (!q) return tracks;

  return tracks.filter((track) => {
    const title = track.title.toLowerCase();
    const artist = (track.artist ?? "").toLowerCase();
    const language = trackLanguageLabel(track.languageCode).toLowerCase();
    return title.includes(q) || artist.includes(q) || language.includes(q);
  });
}

export function sortTracks(
  tracks: Track[],
  key: SortKey,
  dir: SortDir,
): Track[] {
  const sorted = [...tracks];
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "title":
        cmp = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
        break;
      case "artist":
        cmp = compareNullable(a.artist, b.artist, "asc");
        break;
      case "language":
        cmp = compareNullable(
          trackLanguageLabel(a.languageCode) || null,
          trackLanguageLabel(b.languageCode) || null,
          "asc",
        );
        break;
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

export function paneModeClass(
  base: string,
  paneMode: PaneMode,
): string {
  if (paneMode === "list-only") return `${base} ${base}--list-only`;
  if (paneMode === "lyrics-only") return `${base} ${base}--lyrics-only`;
  return base;
}
