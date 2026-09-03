import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TrackSearchState } from "../components/LyricsEditor";
import { errorMessage } from "../lib/format";
import {
  getLyrics,
  onLanguagePreviewFailed,
  onLanguagePreviewFinished,
  onLyricsSearchFailed,
  onLyricsSearchFinished,
  onPipelineFailed,
  onPipelineFinished,
  onPipelinePhase,
  pickAudioFiles,
  previewLrclibLanguage,
  processLyrics,
  processUploads,
  searchLyrics,
  setTrackLanguage,
  type LyricLine,
  type Track,
} from "../lib/tauri";

export type SearchCache = Record<number, TrackSearchState>;

export type PipelineLibraryBridge = {
  upsertTrack: (track: Track) => void;
  setLyricsForTrack: (
    trackId: number,
    value: LyricLine[] | "loading" | "error",
  ) => void;
  refreshTracks: () => Promise<void>;
  setOpenTrackId: (id: number | null) => void;
};

/**
 * Pipeline session: upload/Process/search/preview state and Tauri events.
 */
export function usePipelineSession(
  connected: boolean,
  library: PipelineLibraryBridge,
) {
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [pipelinePhaseByTrack, setPipelinePhaseByTrack] = useState<
    Record<number, string>
  >({});
  const [detectingLanguageIds, setDetectingLanguageIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [languagePreviewWarningByTrack, setLanguagePreviewWarningByTrack] =
    useState<Record<number, string | null>>({});
  const [searchByTrack, setSearchByTrack] = useState<SearchCache>({});

  const libraryRef = useRef(library);
  libraryRef.current = library;

  const markProcessingDone = useCallback((trackId: number) => {
    setProcessingIds((prev) => {
      const next = new Set(prev);
      next.delete(trackId);
      return next;
    });
    setPipelinePhaseByTrack((prev) => {
      if (!(trackId in prev)) return prev;
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
  }, []);

  const markDetectingDone = useCallback((trackId: number) => {
    setDetectingLanguageIds((prev) => {
      const next = new Set(prev);
      next.delete(trackId);
      return next;
    });
  }, []);

  const applySearchResult = useCallback(
    (
      trackId: number,
      query: string | null,
      matches: TrackSearchState["matches"],
      preferredMatchId: number | null,
      error: string | null,
    ) => {
      const activeQuery = query?.trim() ?? "";
      setSearchByTrack((prev) => {
        const current = prev[trackId];
        if (current?.activeQuery !== activeQuery) return prev;
        return {
          ...prev,
          [trackId]: {
            activeQuery,
            searching: false,
            matches,
            preferredMatchId,
            error,
          },
        };
      });
    },
    [],
  );

  useEffect(() => {
    if (!connected) return;

    let cancelled = false;
    let unlistenFinished: (() => void) | undefined;
    let unlistenFailed: (() => void) | undefined;
    let unlistenPhase: (() => void) | undefined;
    let unlistenSearchFinished: (() => void) | undefined;
    let unlistenSearchFailed: (() => void) | undefined;
    let unlistenPreviewFinished: (() => void) | undefined;
    let unlistenPreviewFailed: (() => void) | undefined;

    void (async () => {
      unlistenFinished = await onPipelineFinished((track) => {
        if (cancelled) return;
        markProcessingDone(track.id);
        libraryRef.current.upsertTrack(track);
        void getLyrics(track.id)
          .then((lines) => {
            if (cancelled) return;
            libraryRef.current.setLyricsForTrack(track.id, lines);
          })
          .catch(() => {
            if (cancelled) return;
            libraryRef.current.setLyricsForTrack(track.id, "error");
          });
      });

      unlistenFailed = await onPipelineFailed((error) => {
        if (cancelled) return;
        if (error.trackId > 0) {
          markProcessingDone(error.trackId);
        }
        setPipelineError(error.message);
        void libraryRef.current.refreshTracks();
      });

      unlistenPhase = await onPipelinePhase((event) => {
        if (cancelled || event.trackId <= 0) return;
        if (event.phase === "ready") {
          setPipelinePhaseByTrack((prev) => ({
            ...prev,
            [event.trackId]: event.phase,
          }));
          return;
        }
        if (event.phase === "failed") {
          markProcessingDone(event.trackId);
          return;
        }
        setProcessingIds((prev) => new Set(prev).add(event.trackId));
        setPipelinePhaseByTrack((prev) => ({
          ...prev,
          [event.trackId]: event.phase,
        }));
      });

      unlistenSearchFinished = await onLyricsSearchFinished((result) => {
        if (cancelled) return;
        applySearchResult(
          result.trackId,
          result.query,
          result.matches,
          result.preferredMatchId,
          null,
        );
      });

      unlistenSearchFailed = await onLyricsSearchFailed((error) => {
        if (cancelled) return;
        applySearchResult(error.trackId, error.query, [], null, error.message);
      });

      unlistenPreviewFinished = await onLanguagePreviewFinished((result) => {
        if (cancelled) return;
        markDetectingDone(result.track.id);
        libraryRef.current.upsertTrack(result.track);
        setLanguagePreviewWarningByTrack((prev) => ({
          ...prev,
          [result.track.id]: result.warning,
        }));
      });

      unlistenPreviewFailed = await onLanguagePreviewFailed((error) => {
        if (cancelled) return;
        markDetectingDone(error.trackId);
        setLanguagePreviewWarningByTrack((prev) => ({
          ...prev,
          [error.trackId]: error.message,
        }));
        void libraryRef.current.refreshTracks();
      });
    })();

    return () => {
      cancelled = true;
      unlistenFinished?.();
      unlistenFailed?.();
      unlistenPhase?.();
      unlistenSearchFinished?.();
      unlistenSearchFailed?.();
      unlistenPreviewFinished?.();
      unlistenPreviewFailed?.();
    };
  }, [connected, markProcessingDone, markDetectingDone, applySearchResult]);

  const upload = useCallback(async (onUploaded: () => void) => {
    setBusy(true);
    setPipelineError(null);

    try {
      const paths = await pickAudioFiles();
      if (paths.length === 0) return;

      const uploaded = await processUploads(paths);
      setProcessingIds((prev) => {
        const next = new Set(prev);
        for (const track of uploaded) next.add(track.id);
        return next;
      });
      setPipelinePhaseByTrack((prev) => {
        const next = { ...prev };
        for (const track of uploaded) {
          next[track.id] = prev[track.id] ?? "importing";
        }
        return next;
      });
      libraryRef.current.setOpenTrackId(null);
      await libraryRef.current.refreshTracks();
      onUploaded();
    } catch (err: unknown) {
      setPipelineError(errorMessage(err, "Upload failed"));
      try {
        await libraryRef.current.refreshTracks();
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const requestSearch = useCallback(
    async (trackId: number, query: string) => {
      const activeQuery = query.trim();
      setSearchByTrack((prev) => ({
        ...prev,
        [trackId]: {
          activeQuery,
          searching: true,
          matches: prev[trackId]?.matches ?? [],
          preferredMatchId: prev[trackId]?.preferredMatchId ?? null,
          error: null,
        },
      }));

      try {
        await searchLyrics(trackId, activeQuery || null);
      } catch (err: unknown) {
        applySearchResult(
          trackId,
          activeQuery,
          [],
          null,
          err instanceof Error ? err.message : "Could not start lyrics search.",
        );
      }
    },
    [applySearchResult],
  );

  const processTrackLyrics = useCallback(
    async (trackId: number, pasted: string, lrclibId: number | null) => {
      setPipelineError(null);
      setProcessingIds((prev) => new Set(prev).add(trackId));
      try {
        await processLyrics(trackId, pasted, lrclibId);
      } catch (err: unknown) {
        markProcessingDone(trackId);
        setPipelineError(errorMessage(err, "Could not process lyrics"));
      }
    },
    [markProcessingDone],
  );

  const setLanguage = useCallback(
    async (
      trackId: number,
      languageCode: string | null,
      lrclibId: number | null,
    ) => {
      setPipelineError(null);
      setLanguagePreviewWarningByTrack((prev) => ({ ...prev, [trackId]: null }));
      const isAuto = !languageCode?.trim();
      if (isAuto) {
        setDetectingLanguageIds((prev) => new Set(prev).add(trackId));
      }
      try {
        await setTrackLanguage(trackId, languageCode, isAuto ? lrclibId : null);
      } catch (err: unknown) {
        markDetectingDone(trackId);
        setPipelineError(errorMessage(err, "Could not update song language"));
      }
    },
    [markDetectingDone],
  );

  const previewLanguage = useCallback(
    async (trackId: number, lrclibId: number | null) => {
      setLanguagePreviewWarningByTrack((prev) => ({ ...prev, [trackId]: null }));
      setDetectingLanguageIds((prev) => new Set(prev).add(trackId));
      try {
        await previewLrclibLanguage(trackId, lrclibId);
      } catch (err: unknown) {
        markDetectingDone(trackId);
        setLanguagePreviewWarningByTrack((prev) => ({
          ...prev,
          [trackId]: errorMessage(err, "Could not detect language"),
        }));
      }
    },
    [markDetectingDone],
  );

  const searchingIds = useMemo(
    () =>
      new Set(
        Object.entries(searchByTrack)
          .filter(([, state]) => state.searching)
          .map(([id]) => Number(id)),
      ),
    [searchByTrack],
  );

  const reset = useCallback(() => {
    setPipelineError(null);
    setProcessingIds(new Set());
    setPipelinePhaseByTrack({});
    setDetectingLanguageIds(new Set());
    setLanguagePreviewWarningByTrack({});
    setSearchByTrack({});
  }, []);

  return {
    pipelineError,
    busy,
    processingIds,
    pipelinePhaseByTrack,
    detectingLanguageIds,
    languagePreviewWarningByTrack,
    searchByTrack,
    searchingIds,
    processingCount: processingIds.size,
    upload,
    requestSearch,
    processTrackLyrics,
    setLanguage,
    previewLanguage,
    reset,
  };
}
