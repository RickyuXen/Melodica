import type { LyricLine, Track } from "../lib/tauri";
import { LyricsEditor, type TrackSearchState } from "./LyricsEditor";

type LyricsState = LyricLine[] | "loading" | "error" | undefined;

type TrackItemProps = {
  track: Track;
  lyrics: LyricsState;
  isProcessing: boolean;
  searchState: TrackSearchState | undefined;
  onRequestSearch: (query: string) => void;
  onProcessLyrics: (pasted: string, lrclibId: number | null) => void;
  onSetLanguage: (languageCode: string | null, lrclibId: number | null) => void;
  onPreviewLanguage: (lrclibId: number | null) => void;
  isDetectingLanguage: boolean;
  languagePreviewWarning: string | null;
};

export function TrackItem({
  track,
  lyrics,
  isProcessing,
  searchState,
  onRequestSearch,
  onProcessLyrics,
  onSetLanguage,
  onPreviewLanguage,
  isDetectingLanguage,
  languagePreviewWarning,
}: TrackItemProps) {
  return (
    <LyricsEditor
      trackId={track.id}
      trackTitle={track.title}
      trackArtist={track.artist}
      languageCode={track.languageCode}
      languageManual={track.languageManual}
      lyrics={lyrics}
      isProcessing={isProcessing}
      isDetectingLanguage={isDetectingLanguage}
      languagePreviewWarning={languagePreviewWarning}
      searchState={searchState}
      onRequestSearch={onRequestSearch}
      onProcessLyrics={onProcessLyrics}
      onSetLanguage={onSetLanguage}
      onPreviewLanguage={onPreviewLanguage}
    />
  );
}
