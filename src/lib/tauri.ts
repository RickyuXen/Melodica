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

/** Sends the chosen file into the Rust pipeline; persists track + lyrics. */
export async function processUpload(filePath: string): Promise<Track> {
  return invoke<Track>("process_upload", { filePath });
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
