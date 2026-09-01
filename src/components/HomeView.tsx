import type { LyricLine, Track } from "../lib/tauri";
import { LyricsDisplay } from "./LyricsDisplay";
import { LibraryTrackList } from "./LibraryTrackList";

type LyricsState = LyricLine[] | "loading" | "error" | undefined;

type HomeViewProps = {
  tracks: Track[];
  openTrackId: number | null;
  playingTrackId: number | null;
  lyrics: LyricsState;
  positionMs: number;
  isCurrent: boolean;
  processingIds: Set<number>;
  pipelinePhaseByTrack: Record<number, string>;
  onSelectTrack: (trackId: number) => void;
  onSeekLine: (ms: number) => void;
};

export function HomeView({
  tracks,
  openTrackId,
  playingTrackId,
  lyrics,
  positionMs,
  isCurrent,
  processingIds,
  pipelinePhaseByTrack,
  onSelectTrack,
  onSeekLine,
}: HomeViewProps) {
  const openTrack =
    openTrackId != null ? tracks.find((t) => t.id === openTrackId) : undefined;

  return (
    <div className="home-split">
      <div className="home-split-list track-list-pane">
        <h2 className="home-split-heading">Library</h2>
        <br></br>
        <LibraryTrackList
          tracks={tracks}
          openTrackId={openTrackId}
          playingTrackId={playingTrackId}
          processingIds={processingIds}
          pipelinePhaseByTrack={pipelinePhaseByTrack}
          onSelect={onSelectTrack}
        />
      </div>

      <div className="home-split-lyrics">
        {openTrack ? (
          <>
            <div className="home-lyrics-header">
              <h2 className="home-split-heading">{openTrack.title}</h2>
              {openTrack.artist && (
                <p className="muted home-lyrics-artist">{openTrack.artist}</p>
              )}
            </div>
            <div className="home-lyrics-body">
              <LyricsDisplay
                lyrics={lyrics}
                languageCode={openTrack.languageCode}
                positionMs={positionMs}
                isCurrent={isCurrent}
                onSeekLine={onSeekLine}
              />
            </div>
          </>
        ) : (
          <div className="home-lyrics-empty">
            <p className="muted">Select a song to view lyrics</p>
          </div>
        )}
      </div>
    </div>
  );
}
