//! Entry point for the per-song processing pipeline.

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::read_from_path;
use lofty::tag::{Accessor, ItemKey};
use std::path::Path;
use tauri::{AppHandle, Emitter};

use crate::lrclib::{self, LyricsMatch};
use crate::sidecar;
use crate::storage::{self, Track};
use rusqlite::Connection;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineFailed {
    pub track_id: i64,
    pub message: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsSearchFinished {
    pub track_id: i64,
    pub query: Option<String>,
    pub matches: Vec<LyricsMatch>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsSearchFailed {
    pub track_id: i64,
    pub query: Option<String>,
    pub message: String,
}

/// Fast path: validate the file, save metadata, and store embedded lyrics if present.
pub fn begin_upload(app: &AppHandle, file_path: &str) -> Result<Track, String> {
    let path = Path::new(file_path);
    if !path.is_file() {
        return Err(format!("file not found: {file_path}"));
    }

    let meta = read_file_metadata(path);
    let title = meta
        .title
        .clone()
        .unwrap_or_else(|| storage::title_from_path(file_path));

    let conn = storage::open(app)?;
    let track = storage::upsert_track(
        &conn,
        file_path,
        &title,
        meta.artist.as_deref(),
        meta.album.as_deref(),
        meta.duration_ms,
    )?;

    if meta.lyric_lines.is_empty() {
        return Ok(track);
    }

    storage::replace_lyrics(&conn, track.id, &meta.lyric_lines, "embedded")?;
    apply_detected_language(
        &conn,
        track.id,
        &meta.lyric_lines,
        meta.title.as_deref(),
        meta.artist.as_deref(),
        meta.album.as_deref(),
        Some(file_path),
        None,
    );

    storage::get_track_by_id(&conn, track.id)?
        .ok_or_else(|| format!("track missing after upload: {}", track.id))
}

/// Search LRCLIB off the UI thread and emit completion events.
pub fn spawn_search_lyrics(app: AppHandle, track_id: i64, query: Option<String>) {
    std::thread::spawn(move || {
        match search_lyrics(&app, track_id, query.clone()) {
            Ok(matches) => {
                let _ = app.emit(
                    "lyrics-search-finished",
                    &LyricsSearchFinished {
                        track_id,
                        query,
                        matches,
                    },
                );
            }
            Err(message) => {
                let _ = app.emit(
                    "lyrics-search-failed",
                    &LyricsSearchFailed {
                        track_id,
                        query,
                        message,
                    },
                );
            }
        }
    });
}

/// Search LRCLIB using a custom query, or title/artist from the stored track.
fn search_lyrics(
    app: &AppHandle,
    track_id: i64,
    query: Option<String>,
) -> Result<Vec<LyricsMatch>, String> {
    let conn = storage::open(app)?;
    let track = storage::get_track_by_id(&conn, track_id)?
        .ok_or_else(|| format!("track not found: {track_id}"))?;

    let custom = query
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    if let Some(q) = custom {
        lrclib::search_query(q)
    } else {
        lrclib::search_track(&track.title, track.artist.as_deref())
    }
}

/// Commit lyrics: pasted text, then LRCLIB id, then embedded tags, then Whisper.
pub fn process_lyrics(
    app: &AppHandle,
    track_id: i64,
    pasted: Option<String>,
    lrclib_id: Option<i64>,
) -> Result<Track, String> {
    let conn = storage::open(app)?;
    let track = storage::get_track_by_id(&conn, track_id)?
        .ok_or_else(|| format!("track not found: {track_id}"))?;

    let path = Path::new(&track.file_path);
    if !path.is_file() {
        return Err(format!("file not found: {}", track.file_path));
    }

    let meta = read_file_metadata(path);
    let pasted = pasted
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let mut whisper_language: Option<String> = None;

    let (lyric_lines, source) = if let Some(text) = pasted {
        (split_lyric_lines(&text), "user")
    } else if let Some(id) = lrclib_id {
        let text = lrclib::lyrics_for_id(id)?;
        (split_lyric_lines(&text), "lrclib")
    } else if !meta.lyric_lines.is_empty() {
        (meta.lyric_lines.clone(), "embedded")
    } else {
        let asr = sidecar::transcribe(
            &track.file_path,
            meta.title.as_deref().or(Some(track.title.as_str())),
            meta.artist.as_deref().or(track.artist.as_deref()),
            meta.album.as_deref().or(track.album.as_deref()),
        )?;
        whisper_language = asr.language;
        (asr.lines, "asr")
    };

    if lyric_lines.is_empty() {
        return Err("No lyrics found. Paste lyrics, pick a search match, or try Process again.".to_string());
    }

    storage::replace_lyrics(&conn, track_id, &lyric_lines, source)?;
    let language_code = apply_detected_language(
        &conn,
        track_id,
        &lyric_lines,
        meta.title.as_deref().or(Some(track.title.as_str())),
        meta.artist.as_deref().or(track.artist.as_deref()),
        meta.album.as_deref().or(track.album.as_deref()),
        Some(&track.file_path),
        whisper_language,
    );

    // Soft-fail: originals already saved; translation errors do not fail Process.
    let _ = maybe_translate_lyrics(&conn, track_id, &lyric_lines, language_code.as_deref());

    storage::get_track_by_id(&conn, track_id)?
        .ok_or_else(|| format!("track missing after pipeline: {track_id}"))
}

const DEFAULT_TARGET_LANGUAGE: &str = "en";

fn primary_language_tag(code: &str) -> String {
    code.trim()
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn resolve_translate_credentials(
    conn: &Connection,
) -> Option<sidecar::TranslateCredentials> {
    let settings_key = storage::get_translate_api_key(conn).ok().flatten();
    let api_key = settings_key.or_else(|| {
        std::env::var("MELODICA_TRANSLATE_API_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    })?;

    let base_url = std::env::var("MELODICA_TRANSLATE_BASE_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let model = std::env::var("MELODICA_TRANSLATE_MODEL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    Some(sidecar::TranslateCredentials {
        api_key,
        base_url,
        model,
    })
}

fn maybe_translate_lyrics(
    conn: &Connection,
    track_id: i64,
    lyric_lines: &[(Option<i64>, String)],
    language_code: Option<&str>,
) -> Result<(), String> {
    let target = DEFAULT_TARGET_LANGUAGE;
    if let Some(code) = language_code {
        if primary_language_tag(code) == target {
            return Ok(());
        }
    }

    let credentials = resolve_translate_credentials(conn).ok_or_else(|| {
        "No translation API key. Set one in Settings or MELODICA_TRANSLATE_API_KEY."
            .to_string()
    })?;

    let indexed: Vec<(i64, &str)> = lyric_lines
        .iter()
        .enumerate()
        .map(|(i, (_, text))| (i as i64, text.as_str()))
        .collect();

    let translations = sidecar::translate_align(
        &track_id.to_string(),
        &indexed,
        target,
        language_code,
        &credentials,
    )?;

    if translations.is_empty() {
        return Err("Translation returned no lines".to_string());
    }

    storage::apply_line_translations(conn, track_id, &translations)
}

/// Spawn lyrics + language work off the UI thread and emit completion events.
pub fn spawn_process_lyrics(
    app: AppHandle,
    track_id: i64,
    pasted: Option<String>,
    lrclib_id: Option<i64>,
) {
    std::thread::spawn(move || {
        match process_lyrics(&app, track_id, pasted, lrclib_id) {
            Ok(track) => {
                let _ = app.emit("pipeline-finished", &track);
            }
            Err(message) => {
                let _ = app.emit(
                    "pipeline-failed",
                    &PipelineFailed { track_id, message },
                );
            }
        }
    });
}

fn apply_detected_language(
    conn: &Connection,
    track_id: i64,
    lyric_lines: &[(Option<i64>, String)],
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    file_path: Option<&str>,
    whisper_language: Option<String>,
) -> Option<String> {
    if lyric_lines.is_empty() {
        if let Some(code) = whisper_language {
            let _ = storage::set_language_code(conn, track_id, &code);
            return Some(code);
        }
        return None;
    }

    let lyrics_text = lyric_lines
        .iter()
        .map(|(_, text)| text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let language = match sidecar::detect_language(
        &lyrics_text,
        title,
        artist,
        album,
        file_path,
    ) {
        Ok(code) => Some(code),
        Err(_) => whisper_language,
    };

    if let Some(ref code) = language {
        let _ = storage::set_language_code(conn, track_id, code);
    }
    language
}

struct FileMetadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_ms: Option<i64>,
    lyric_lines: Vec<(Option<i64>, String)>,
}

fn read_file_metadata(path: &Path) -> FileMetadata {
    let Ok(tagged) = read_from_path(path) else {
        return FileMetadata {
            title: None,
            artist: None,
            album: None,
            duration_ms: None,
            lyric_lines: Vec::new(),
        };
    };

    let duration_ms = {
        let ms = tagged.properties().duration().as_millis() as i64;
        if ms > 0 {
            Some(ms)
        } else {
            None
        }
    };

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());

    let (title, artist, album, lyrics_text) = if let Some(tag) = tag {
        let lyrics = tag
            .get_string(ItemKey::Lyrics)
            .or_else(|| tag.get_string(ItemKey::UnsyncLyrics))
            .map(|s| s.to_string());

        (
            tag.title().map(|s| s.to_string()),
            tag.artist().map(|s| s.to_string()),
            tag.album().map(|s| s.to_string()),
            lyrics,
        )
    } else {
        (None, None, None, None)
    };

    let lyric_lines = lyrics_text
        .as_deref()
        .map(split_lyric_lines)
        .unwrap_or_default();

    FileMetadata {
        title,
        artist,
        album,
        duration_ms,
        lyric_lines,
    }
}

/// Split raw lyrics into cache rows. Supports plain text and simple LRC timestamps.
fn split_lyric_lines(text: &str) -> Vec<(Option<i64>, String)> {
    let mut lines = Vec::new();

    for raw in text.lines() {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }

        if let Some((timestamp_ms, content)) = parse_lrc_line(raw) {
            if !content.is_empty() {
                lines.push((Some(timestamp_ms), content));
            }
        } else {
            lines.push((None, raw.to_string()));
        }
    }

    lines
}

fn parse_lrc_line(line: &str) -> Option<(i64, String)> {
    // [mm:ss.xx]text  or  [mm:ss]text
    if !line.starts_with('[') {
        return None;
    }
    let close = line.find(']')?;
    let stamp = &line[1..close];
    let content = line[close + 1..].trim().to_string();

    let parts: Vec<&str> = stamp.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let minutes: i64 = parts[0].parse().ok()?;
    let seconds_part = parts[1];
    let (secs, frac) = if let Some((s, f)) = seconds_part.split_once('.') {
        let secs: i64 = s.parse().ok()?;
        let frac_ms = match f.len() {
            1 => f.parse::<i64>().ok()? * 100,
            2 => f.parse::<i64>().ok()? * 10,
            _ => f.chars().take(3).collect::<String>().parse().ok()?,
        };
        (secs, frac_ms)
    } else {
        (seconds_part.parse().ok()?, 0)
    };

    Some((minutes * 60_000 + secs * 1_000 + frac, content))
}
