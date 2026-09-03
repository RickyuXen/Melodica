import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/format";
import {
  playbackPlay,
  playbackPlayNext,
  playbackPlayPrevious,
  playbackSeek,
  playbackStatus,
  playbackToggle,
  setVolume as setVolumeCommand,
  type PlaybackStatus,
  type Track,
} from "../lib/tauri";

const emptyPlayback: PlaybackStatus = {
  trackId: null,
  playing: false,
  positionMs: 0,
  durationMs: 0,
};

type PlaybackBridge = {
  onDurationKnown?: (trackId: number, durationMs: number) => void;
  /** When playback starts/switches track, mirror into library open selection. */
  onPlayingTrackChange?: (trackId: number) => void;
};

/**
 * Playback session: engine status, scrub, volume.
 * Duration backfill into library is a deliberate cross-session write.
 */
export function usePlaybackSession(
  connected: boolean,
  bridge: PlaybackBridge = {},
) {
  const [playback, setPlayback] = useState<PlaybackStatus>(emptyPlayback);
  const [volume, setVolumeState] = useState(1);
  const [scrub, setScrub] = useState<{ trackId: number; ms: number } | null>(
    null,
  );
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const seekingRef = useRef(false);
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const playbackTrackIdRef = useRef<number | null>(null);
  playbackTrackIdRef.current = playback.trackId;

  const applyPlayback = useCallback((status: PlaybackStatus) => {
    setPlayback(status);
    setScrub(null);
    if (status.trackId != null) {
      bridgeRef.current.onPlayingTrackChange?.(status.trackId);
    }
    if (status.trackId != null && status.durationMs > 0) {
      bridgeRef.current.onDurationKnown?.(status.trackId, status.durationMs);
    }
    return status;
  }, []);

  useEffect(() => {
    if (!connected) return;

    let cancelled = false;

    async function poll() {
      try {
        const status = await playbackStatus();
        if (cancelled || seekingRef.current) return;
        setPlayback(status);
        if (status.trackId != null && status.durationMs > 0) {
          bridgeRef.current.onDurationKnown?.(status.trackId, status.durationMs);
        }
      } catch {
        /* ignore transient poll errors */
      }
    }

    void poll();
    const id = window.setInterval(poll, 250);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [connected]);

  const playTrack = useCallback(
    async (trackId: number) => {
      setPlaybackError(null);
      try {
        return applyPlayback(await playbackPlay(trackId));
      } catch (err: unknown) {
        setPlaybackError(errorMessage(err, "Playback failed"));
        return null;
      }
    },
    [applyPlayback],
  );

  const playPause = useCallback(
    async (currentTrack: Track | undefined) => {
      if (!currentTrack) return;
      setPlaybackError(null);
      try {
        const isCurrent = playback.trackId === currentTrack.id;
        const finished =
          isCurrent &&
          !playback.playing &&
          playback.durationMs > 0 &&
          playback.positionMs >= playback.durationMs;
        const status =
          isCurrent && !finished
            ? await playbackToggle()
            : await playbackPlay(currentTrack.id);
        applyPlayback(status);
      } catch (err: unknown) {
        setPlaybackError(errorMessage(err, "Playback failed"));
      }
    },
    [playback, applyPlayback],
  );

  const seekCommit = useCallback(
    async (valueMs: number, currentTrack: Track | undefined) => {
      if (!currentTrack) return;
      seekingRef.current = true;
      setPlaybackError(null);
      try {
        if (playback.trackId !== currentTrack.id) {
          await playbackPlay(currentTrack.id);
        }
        applyPlayback(await playbackSeek(valueMs));
      } catch (err: unknown) {
        setPlaybackError(errorMessage(err, "Seek failed"));
      } finally {
        seekingRef.current = false;
        setScrub(null);
      }
    },
    [playback.trackId, applyPlayback],
  );

  const seekLine = useCallback(
    async (ms: number, openTrackId: number | null) => {
      if (openTrackId == null) return;
      seekingRef.current = true;
      setPlaybackError(null);
      try {
        if (playback.trackId !== openTrackId) {
          applyPlayback(await playbackPlay(openTrackId));
        }
        applyPlayback(await playbackSeek(ms));
      } catch (err: unknown) {
        setPlaybackError(errorMessage(err, "Seek failed"));
      } finally {
        seekingRef.current = false;
        setScrub(null);
      }
    },
    [playback.trackId, applyPlayback],
  );

  const changeVolume = useCallback(
    async (next: number) => {
      const clamped = Math.min(1, Math.max(0, next));
      setVolumeState(clamped);
      if (!connected) return;
      try {
        await setVolumeCommand(clamped);
      } catch (err: unknown) {
        setPlaybackError(errorMessage(err, "Could not set volume"));
      }
    },
    [connected],
  );

  const playNext = useCallback(async () => {
    setPlaybackError(null);
    try {
      return applyPlayback(await playbackPlayNext()).trackId;
    } catch (err: unknown) {
      setPlaybackError(errorMessage(err, "Could not play next track"));
      return null;
    }
  }, [applyPlayback]);

  const playPrevious = useCallback(async () => {
    setPlaybackError(null);
    try {
      return applyPlayback(await playbackPlayPrevious()).trackId;
    } catch (err: unknown) {
      setPlaybackError(errorMessage(err, "Could not play previous track"));
      return null;
    }
  }, [applyPlayback]);

  const beginScrub = useCallback((ms: number) => {
    const trackId = playbackTrackIdRef.current;
    if (trackId != null) {
      setScrub({ trackId, ms });
    }
  }, []);

  const cancelSeek = useCallback(() => {
    seekingRef.current = false;
    setScrub(null);
  }, []);

  const pointerDownSeek = useCallback(() => {
    seekingRef.current = true;
  }, []);

  const reset = useCallback(() => {
    setPlaybackError(null);
    setPlayback(emptyPlayback);
    setScrub(null);
    seekingRef.current = false;
  }, []);

  const displayPositionMs =
    scrub?.trackId === playback.trackId ? scrub.ms : playback.positionMs;

  return {
    playback,
    volume,
    playbackError,
    setPlaybackError,
    playTrack,
    playPause,
    seekCommit,
    seekLine,
    changeVolume,
    playNext,
    playPrevious,
    beginScrub,
    cancelSeek,
    pointerDownSeek,
    displayPositionMs,
    reset,
  };
}
