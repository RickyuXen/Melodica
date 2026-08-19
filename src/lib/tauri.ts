export type AppInfo = {
  name: string;
  version: string;
};

export type Track = {
  id: number;
  filePath: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  languageCode: string | null;
  addedAt: string;
};

export type LyricLine = {
  id: number;
  trackId: number;
  lineIndex: number;
  timestampMs: number | null;
  originalText: string;
  translatedText: string | null;
  source: string;
};

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}

/** Opens a native file picker and returns the selected path, or null if cancelled. */
export async function pickAudioFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    title: "Choose a music file",
    filters: [
      {
        name: "Audio",
        extensions: ["mp3", "flac", "wav", "ogg", "m4a", "aac"],
      },
    ],
  });

  if (selected === null || Array.isArray(selected)) {
    return null;
  }
  return selected;
}

/** Sends the chosen file into the Rust pipeline; returns as soon as the track row exists. */
export async function processUpload(filePath: string): Promise<Track> {
  return invoke<Track>("process_upload", { filePath });
}

export type LyricsMatch = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  durationSeconds: number | null;
  instrumental: boolean;
  hasSynced: boolean;
  hasPlain: boolean;
};

export async function searchLyrics(
  trackId: number,
  query?: string | null,
): Promise<LyricsMatch[]> {
  return invoke<LyricsMatch[]>("search_lyrics", {
    trackId,
    query: query?.trim() ? query.trim() : null,
  });
}

export async function processLyrics(
  trackId: number,
  pasted?: string | null,
  lrclibId?: number | null,
): Promise<void> {
  return invoke<void>("process_lyrics", {
    trackId,
    pasted: pasted?.trim() ? pasted : null,
    lrclibId: lrclibId ?? null,
  });
}

export type PipelineFailed = {
  trackId: number;
  message: string;
};

export async function onPipelineFinished(
  handler: (track: Track) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<Track>("pipeline-finished", (event) => {
    handler(event.payload);
  });
  return unlisten;
}

export async function onPipelineFailed(
  handler: (error: PipelineFailed) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<PipelineFailed>("pipeline-failed", (event) => {
    handler(event.payload);
  });
  return unlisten;
}

export async function listTracks(): Promise<Track[]> {
  return invoke<Track[]>("list_tracks");
}

export async function getLyrics(trackId: number): Promise<LyricLine[]> {
  return invoke<LyricLine[]>("get_lyrics", { trackId });
}

export type PlaybackStatus = {
  trackId: number | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
};

export async function playbackPlay(trackId: number): Promise<PlaybackStatus> {
  return invoke<PlaybackStatus>("playback_play", { trackId });
}

export async function playbackToggle(): Promise<PlaybackStatus> {
  return invoke<PlaybackStatus>("playback_toggle");
}

export async function playbackSeek(positionMs: number): Promise<PlaybackStatus> {
  return invoke<PlaybackStatus>("playback_seek", { positionMs });
}

export async function playbackStatus(): Promise<PlaybackStatus> {
  return invoke<PlaybackStatus>("playback_status");
}
