import { useCallback, useEffect, useRef, useState } from "react";
import { getLyrics, listTracks, type LyricLine, type Track } from "../lib/tauri";

export type LyricsCache = Record<number, LyricLine[] | "loading" | "error">;

/**
 * Library session: tracks, lyrics cache, Home/Edit selection.
 * Playback may patch tracks.durationMs via patchTrackDuration (cross-session write).
 */
export function useLibrarySession() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [lyricsByTrack, setLyricsByTrack] = useState<LyricsCache>({});
  const [openTrackId, setOpenTrackId] = useState<number | null>(null);
  const [selectedEditTrackId, setSelectedEditTrackId] = useState<number | null>(
    null,
  );
  const lyricsByTrackRef = useRef(lyricsByTrack);
  lyricsByTrackRef.current = lyricsByTrack;

  const refreshTracks = useCallback(async () => {
    setTracks(await listTracks());
  }, []);

  const upsertTrack = useCallback((track: Track) => {
    setTracks((prev) => {
      const idx = prev.findIndex((t) => t.id === track.id);
      if (idx === -1) return [track, ...prev];
      const next = [...prev];
      next[idx] = track;
      return next;
    });
  }, []);

  const patchTrackDuration = useCallback((trackId: number, durationMs: number) => {
    if (durationMs <= 0) return;
    setTracks((prev) =>
      prev.map((t) =>
        t.id === trackId && (t.durationMs == null || t.durationMs <= 0)
          ? { ...t, durationMs }
          : t,
      ),
    );
  }, []);

  const setLyricsForTrack = useCallback(
    (trackId: number, value: LyricLine[] | "loading" | "error") => {
      setLyricsByTrack((prev) => ({ ...prev, [trackId]: value }));
    },
    [],
  );

  const loadLyrics = useCallback(async (trackId: number) => {
    const cached = lyricsByTrackRef.current[trackId];
    if (cached && cached !== "error") return;

    setLyricsByTrack((prev) => ({ ...prev, [trackId]: "loading" }));
    try {
      const lines = await getLyrics(trackId);
      setLyricsByTrack((prev) => ({ ...prev, [trackId]: lines }));
    } catch {
      setLyricsByTrack((prev) => ({ ...prev, [trackId]: "error" }));
    }
  }, []);

  useEffect(() => {
    if (selectedEditTrackId == null) return;
    if (tracks.some((t) => t.id === selectedEditTrackId)) return;
    setSelectedEditTrackId(null);
  }, [tracks, selectedEditTrackId]);

  const reset = useCallback(() => {
    setTracks([]);
    setLyricsByTrack({});
    setOpenTrackId(null);
    setSelectedEditTrackId(null);
  }, []);

  return {
    tracks,
    lyricsByTrack,
    openTrackId,
    setOpenTrackId,
    selectedEditTrackId,
    setSelectedEditTrackId,
    refreshTracks,
    upsertTrack,
    patchTrackDuration,
    setLyricsForTrack,
    loadLyrics,
    reset,
  };
}
