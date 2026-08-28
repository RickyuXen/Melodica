import { useEffect, useRef, useState } from "react";
import { primaryLanguageTag } from "../lib/format";
import type { LyricLine, WordGloss } from "../lib/tauri";
import { activeLyricLineIndex, lyricsAreSynced } from "../lib/lyricsSync";

type LyricsState = LyricLine[] | "loading" | "error" | undefined;

const AUTO_SCROLL_RESUME_MS = 3000;
const DEFAULT_TARGET = "en";

type LyricsDisplayProps = {
  lyrics: LyricsState;
  languageCode: string | null;
  positionMs: number;
  isCurrent: boolean;
  onSeekLine: (ms: number) => void;
};

function lineHasTranslation(line: LyricLine): boolean {
  const glosses = line.wordGlosses;
  return Boolean(
    (line.translatedText && line.translatedText.trim()) ||
      (glosses && glosses.length > 0),
  );
}

function LineStudyBody({
  originalText,
  translatedText,
  wordGlosses,
}: {
  originalText: string;
  translatedText: string | null;
  wordGlosses: WordGloss[] | null;
}) {
  const glosses = wordGlosses?.filter((g) => g.text.trim()) ?? [];
  const sense = translatedText?.trim() || null;

  if (glosses.length === 0 && !sense) {
    return <span className="lyrics-original-only">{originalText}</span>;
  }

  return (
    <div className="lyrics-study">
      <div className="lyrics-study-words">
        {glosses.length > 0 ? (
          <div className="lyrics-word-row" aria-label="Original with glosses">
            {glosses.map((g, i) => (
              <span key={`${g.text}-${i}`} className="lyrics-word-pair">
                <span className="lyrics-word-original">{g.text}</span>
                <span className="lyrics-word-gloss">{g.gloss || "·"}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="lyrics-original-only">{originalText}</span>
        )}
      </div>
      {sense && (
        <>
          <div className="lyrics-study-sep" aria-hidden="true" />
          <p className="lyrics-study-sense">{sense}</p>
        </>
      )}
    </div>
  );
}

export function LyricsDisplay({
  lyrics,
  languageCode,
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

  const primary = primaryLanguageTag(languageCode);
  const expectsTranslation = primary !== DEFAULT_TARGET;
  const anyTranslated =
    Array.isArray(lyrics) && lyrics.some((line) => lineHasTranslation(line));
  const showSoftFail =
    Array.isArray(lyrics) &&
    lyrics.length > 0 &&
    expectsTranslation &&
    !anyTranslated;

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
        className={`lyrics-lines${synced ? " has-sync" : ""}${isCurrent && synced ? " is-current-track" : ""}${anyTranslated ? " has-study" : ""}`}
        onWheel={synced ? pauseAutoScroll : undefined}
        onTouchMove={synced ? pauseAutoScroll : undefined}
      >
        {lyrics.map((line, index) => {
          const timed = line.timestampMs != null;
          const isActive = index === activeIndex;
          const className = `lyrics-line${isActive ? " is-active" : ""}`;
          const body = (
            <LineStudyBody
              originalText={line.originalText}
              translatedText={line.translatedText}
              wordGlosses={line.wordGlosses}
            />
          );

          if (synced && timed) {
            return (
              <li key={line.id}>
                <button
                  type="button"
                  className={className}
                  ref={isActive ? activeRef : undefined}
                  onClick={() => onSeekLine(line.timestampMs!)}
                >
                  {body}
                </button>
              </li>
            );
          }

          return (
            <li key={line.id} className={`${className} is-inert`}>
              {body}
            </li>
          );
        })}
      </ul>
      {showSoftFail && (
        <p className="muted lyrics-sync-hint">
          Couldn’t translate — try Process again (check your API key in
          Settings).
        </p>
      )}
      {!synced && (
        <p className="muted lyrics-sync-hint">
          Lyrics aren’t time-synced — open Edit to fetch synced lyrics.
        </p>
      )}
    </>
  );
}
