import type { LyricLine } from "../lib/tauri";

type LyricsState = LyricLine[] | "loading" | "error" | undefined;

type LyricsDisplayProps = {
  lyrics: LyricsState;
};

export function LyricsDisplay({ lyrics }: LyricsDisplayProps) {
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
    <ul className="lyrics-lines">
      {lyrics.map((line) => (
        <li key={line.id}>{line.originalText}</li>
      ))}
    </ul>
  );
}
