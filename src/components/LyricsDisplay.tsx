import { useEffect, useRef, useState } from "react";
import type { LyricLine } from "../lib/tauri";
import { activeLyricLineIndex, lyricsAreSynced } from "../lib/lyricsSync";

type LyricsState = LyricLine[] | "loading" | "error" | undefined;

const AUTO_SCROLL_RESUME_MS = 3000;

type LyricsDisplayProps = {
  lyrics: LyricsState;
  positionMs: number;
  isCurrent: boolean;
  onSeekLine: (ms: number) => void;
};

export function LyricsDisplay({
  lyrics,
  positionMs,
  isCurrent,
  onSeekLine,
}: LyricsDisplayProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const [autoScrollPaused, setAutoScrollPaused] = useState(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const synced = Array.isArray(lyrics) && lyricsAreSynced(lyrics);
  const activeIndex =
    synced && isCurrent && Array.isArray(lyrics)
      ? activeLyricLineIndex(lyrics, positionMs)
      : -1;

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current != null) {
        clearTimeout(resumeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (autoScrollPaused || activeIndex < 0) return;
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, autoScrollPaused]);

  function pauseAutoScroll() {
    setAutoScrollPaused(true);
    if (resumeTimerRef.current != null) {
      clearTimeout(resumeTimerRef.current);
    }
    resumeTimerRef.current = setTimeout(() => {
      setAutoScrollPaused(false);
      resumeTimerRef.current = null;
    }, AUTO_SCROLL_RESUME_MS);
  }

  if (lyrics === "loading") {
    return <p className="muted">Loading lyrics…</p>;
  }

  if (lyrics === "error") {
    return <p className="error">Could not load lyrics.</p>;
  }

  if (!lyrics || lyrics.length === 0) {
    return (
      <p className="muted">
        No lyrics available yet. Head to Edit to add or process lyrics.
      </p>
    );
  }

  return (
    <>
      <ul
        ref={listRef}
        className={`lyrics-lines${synced ? " has-sync" : ""}${isCurrent && synced ? " is-current-track" : ""}`}
        onWheel={synced ? pauseAutoScroll : undefined}
        onTouchMove={synced ? pauseAutoScroll : undefined}
      >
        {lyrics.map((line, index) => {
          const timed = line.timestampMs != null;
          const isActive = index === activeIndex;
          const className = `lyrics-line${isActive ? " is-active" : ""}`;

          if (synced && timed) {
            return (
              <li key={line.id}>
                <button
                  type="button"
                  className={className}
                  ref={isActive ? activeRef : undefined}
                  onClick={() => onSeekLine(line.timestampMs!)}
                >
                  {line.originalText}
                </button>
              </li>
            );
          }

          return (
            <li key={line.id} className={`${className} is-inert`}>
              {line.originalText}
            </li>
          );
        })}
      </ul>
      {!synced && (
        <p className="muted lyrics-sync-hint">
          Lyrics aren’t time-synced — open Edit to fetch synced lyrics.
        </p>
      )}
    </>
  );
}
