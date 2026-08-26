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
  languageManual: boolean;
  addedAt: string;
};

export type LyricLine = {
  id: number;
  trackId: number;
  lineIndex: number;
  timestampMs: number | null;
  originalText: string;
  translatedText: string | null;
  wordGlosses: WordGloss[] | null;
  source: string;
};

export type WordGloss = {
  text: string;
  gloss: string;
};

export type TranslateApiKeyStatus = {
  hasKey: boolean;
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
): Promise<void> {
  return invoke<void>("search_lyrics", {
    trackId,
    query: query?.trim() ? query.trim() : null,
  });
}

export type LyricsSearchFinished = {
  trackId: number;
  query: string | null;
  matches: LyricsMatch[];
};

export type LyricsSearchFailed = {
  trackId: number;
  query: string | null;
  message: string;
};

export async function onLyricsSearchFinished(
  handler: (result: LyricsSearchFinished) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<LyricsSearchFinished>(
    "lyrics-search-finished",
    (event) => {
      handler(event.payload);
    },
  );
  return unlisten;
}

export async function onLyricsSearchFailed(
  handler: (error: LyricsSearchFailed) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<LyricsSearchFailed>(
    "lyrics-search-failed",
    (event) => {
      handler(event.payload);
    },
  );
  return unlisten;
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

/** Set song language from Edit. Pass null/empty for auto-detect (preference only).
 *  Optional lrclibId re-runs select-time detect when choosing Auto. */
export async function setTrackLanguage(
  trackId: number,
  languageCode?: string | null,
  lrclibId?: number | null,
): Promise<void> {
  const trimmed = languageCode?.trim() ?? "";
  return invoke<void>("set_track_language", {
    trackId,
    languageCode: trimmed ? trimmed : null,
    lrclibId: lrclibId ?? null,
  });
}

/** Select-time LRCLIB fetch + language detect. Does not persist lyrics. */
export async function previewLrclibLanguage(
  trackId: number,
  lrclibId?: number | null,
): Promise<void> {
  return invoke<void>("preview_lrclib_language", {
    trackId,
    lrclibId: lrclibId ?? null,
  });
}

export type LanguagePreviewFinished = {
  track: Track;
  warning: string | null;
};

export type LanguagePreviewFailed = {
  trackId: number;
  message: string;
};

export async function onLanguagePreviewFinished(
  handler: (result: LanguagePreviewFinished) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<LanguagePreviewFinished>(
    "language-preview-finished",
    (event) => {
      handler(event.payload);
    },
  );
  return unlisten;
}

export async function onLanguagePreviewFailed(
  handler: (error: LanguagePreviewFailed) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<LanguagePreviewFailed>(
    "language-preview-failed",
    (event) => {
      handler(event.payload);
    },
  );
  return unlisten;
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

/** Clears all library data in SQLite and stops playback. */
export async function resetDatabase(): Promise<void> {
  return invoke<void>("reset_database");
}

export async function getLyrics(trackId: number): Promise<LyricLine[]> {
  return invoke<LyricLine[]>("get_lyrics", { trackId });
}

export async function getTranslateApiKeyStatus(): Promise<TranslateApiKeyStatus> {
  return invoke<TranslateApiKeyStatus>("get_translate_api_key_status");
}

/** Save or clear the Settings API key. Pass null/empty to clear (falls back to env). */
export async function setTranslateApiKey(
  apiKey: string | null,
): Promise<TranslateApiKeyStatus> {
  const trimmed = apiKey?.trim() ?? "";
  return invoke<TranslateApiKeyStatus>("set_translate_api_key", {
    apiKey: trimmed ? trimmed : null,
  });
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
