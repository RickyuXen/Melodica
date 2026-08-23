import type { LyricLine } from "./tauri";

/** True when at least one line has a start timestamp. */
export function lyricsAreSynced(lines: LyricLine[]): boolean {
  return lines.some((line) => line.timestampMs != null);
}

/**
 * Index of the active karaoke line for `positionMs`, or `-1` if none yet.
 * Uses the last timed line with `timestampMs <= positionMs`; null-timestamp
 * lines are ignored.
 */
export function activeLyricLineIndex(
  lines: LyricLine[],
  positionMs: number,
): number {
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    const ts = lines[i].timestampMs;
    if (ts != null && ts <= positionMs) {
      active = i;
    }
  }
  return active;
}
