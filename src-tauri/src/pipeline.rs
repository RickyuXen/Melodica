//! Entry point for the per-song processing pipeline.

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::read_from_path;
use lofty::tag::{Accessor, ItemKey};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

use crate::lrclib::{self, LyricsMatch};
use crate::sidecar;
use crate::storage::{self, Track};
use rusqlite::Connection;

/// Per-track generation so stale select-time detect results do not overwrite newer work.
fn preview_generations() -> &'static Mutex<HashMap<i64, u64>> {
    static MAP: OnceLock<Mutex<HashMap<i64, u64>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn bump_preview_generation(track_id: i64) -> u64 {
    let mut map = preview_generations()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let entry = map.entry(track_id).or_insert(0);
    *entry = entry.wrapping_add(1);
    *entry
}

fn preview_generation_matches(track_id: i64, gen: u64) -> bool {
    let map = preview_generations()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    map.get(&track_id).copied() == Some(gen)
}

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

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguagePreviewFinished {
    pub track: Track,
    /// Soft-fail hint (empty/instrumental/detect error). None on success or no-op.
    pub warning: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguagePreviewFailed {
    pub track_id: i64,
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
    if !track.language_manual {
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
    }

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
    // Invalidate in-flight select-time detects for this track.
    let _ = bump_preview_generation(track_id);

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
    let language_code = if track.language_manual {
        track.language_code.clone()
    } else {
        apply_detected_language(
            &conn,
            track_id,
            &lyric_lines,
            meta.title.as_deref().or(Some(track.title.as_str())),
            meta.artist.as_deref().or(track.artist.as_deref()),
            meta.album.as_deref().or(track.album.as_deref()),
            Some(&track.file_path),
            whisper_language,
        )
    };

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

/// Set or clear the song language from Edit. Empty/None = auto-detect mode.
/// Preference only: does not save lyrics or run translation (Process does that).
/// When clearing to auto with an LRCLIB id, runs select-time detect on that match in-thread.
pub fn set_track_language(
    app: &AppHandle,
    track_id: i64,
    language_code: Option<String>,
    lrclib_id: Option<i64>,
) -> Result<(Track, Option<String>), String> {
    let gen = bump_preview_generation(track_id);

    let conn = storage::open(app)?;
    let _track = storage::get_track_by_id(&conn, track_id)?
        .ok_or_else(|| format!("track not found: {track_id}"))?;

    let normalized = language_code
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase());

    match normalized.as_deref() {
        None | Some("auto") => {
            storage::clear_language_manual(&conn, track_id)?;
            storage::clear_language_code(&conn, track_id)?;
            drop(conn);
            if lrclib_id.is_some() {
                return preview_lrclib_language_with_gen(app, track_id, lrclib_id, gen);
            }
            let conn = storage::open(app)?;
            let updated = storage::get_track_by_id(&conn, track_id)?
                .ok_or_else(|| format!("track missing after language update: {track_id}"))?;
            Ok((updated, None))
        }
        Some(code) => {
            storage::set_language_code(&conn, track_id, code, true)?;
            let updated = storage::get_track_by_id(&conn, track_id)?
                .ok_or_else(|| format!("track missing after language update: {track_id}"))?;
            Ok((updated, None))
        }
    }
}

pub fn spawn_set_track_language(
    app: AppHandle,
    track_id: i64,
    language_code: Option<String>,
    lrclib_id: Option<i64>,
) {
    std::thread::spawn(move || {
        match set_track_language(&app, track_id, language_code, lrclib_id) {
            Ok((track, warning)) => {
                let _ = app.emit("pipeline-finished", &track);
                if lrclib_id.is_some() {
                    let _ = app.emit(
                        "language-preview-finished",
                        &LanguagePreviewFinished {
                            track: track.clone(),
                            warning,
                        },
                    );
                }
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

/// Select-time language preview: fetch LRCLIB lyrics and detect, without persisting lyrics.
/// Does not overwrite a manual language. Soft-fails empty/instrumental/detect errors.
pub fn preview_lrclib_language(
    app: &AppHandle,
    track_id: i64,
    lrclib_id: Option<i64>,
) -> Result<(Track, Option<String>), String> {
    let gen = bump_preview_generation(track_id);
    preview_lrclib_language_with_gen(app, track_id, lrclib_id, gen)
}

fn preview_lrclib_language_with_gen(
    app: &AppHandle,
    track_id: i64,
    lrclib_id: Option<i64>,
    gen: u64,
) -> Result<(Track, Option<String>), String> {
    let conn = storage::open(app)?;
    let track = storage::get_track_by_id(&conn, track_id)?
        .ok_or_else(|| format!("track not found: {track_id}"))?;

    if track.language_manual {
        return Ok((track, None));
    }

    if lrclib_id.is_none() {
        storage::clear_language_code(&conn, track_id)?;
        if !preview_generation_matches(track_id, gen) {
            return Ok((track, None));
        }
        let updated = storage::get_track_by_id(&conn, track_id)?
            .ok_or_else(|| format!("track missing after language clear: {track_id}"))?;
        return Ok((updated, None));
    }

    let id = lrclib_id.expect("lrclib_id checked above");
    storage::clear_language_code(&conn, track_id)?;

    let lyrics_text = match lrclib::lyrics_for_id(id) {
        Ok(text) => text,
        Err(message) => {
            if !preview_generation_matches(track_id, gen) {
                return Ok((track, None));
            }
            let updated = storage::get_track_by_id(&conn, track_id)?
                .ok_or_else(|| format!("track missing after language clear: {track_id}"))?;
            return Ok((updated, Some(message)));
        }
    };

    let lyric_lines = split_lyric_lines(&lyrics_text);
    if lyric_lines.is_empty() {
        if !preview_generation_matches(track_id, gen) {
            return Ok((track, None));
        }
        let updated = storage::get_track_by_id(&conn, track_id)?
            .ok_or_else(|| format!("track missing after language clear: {track_id}"))?;
        return Ok((
            updated,
            Some("That match has no usable lyrics text.".to_string()),
        ));
    }

    if !preview_generation_matches(track_id, gen) {
        return Ok((track, None));
    }

    // Re-check manual in case the user overrode while we were fetching.
    let track = storage::get_track_by_id(&conn, track_id)?
        .ok_or_else(|| format!("track not found: {track_id}"))?;
    if track.language_manual {
        return Ok((track, None));
    }

    let detected = apply_detected_language(
        &conn,
        track_id,
        &lyric_lines,
        Some(track.title.as_str()),
        track.artist.as_deref(),
        track.album.as_deref(),
        Some(&track.file_path),
        None,
    );

    if !preview_generation_matches(track_id, gen) {
        return Ok((track, None));
    }

    let updated = storage::get_track_by_id(&conn, track_id)?
        .ok_or_else(|| format!("track missing after language preview: {track_id}"))?;
    if updated.language_manual {
        return Ok((updated, None));
    }

    let warning = if detected.is_none() {
        Some("Could not detect language from that match.".to_string())
    } else {
        None
    };
    Ok((updated, warning))
}

pub fn spawn_preview_lrclib_language(app: AppHandle, track_id: i64, lrclib_id: Option<i64>) {
    std::thread::spawn(move || {
        match preview_lrclib_language(&app, track_id, lrclib_id) {
            Ok((track, warning)) => {
                let _ = app.emit(
                    "language-preview-finished",
                    &LanguagePreviewFinished { track, warning },
                );
            }
            Err(message) => {
                let _ = app.emit(
                    "language-preview-failed",
                    &LanguagePreviewFailed { track_id, message },
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
            let _ = storage::set_language_code(conn, track_id, &code, false);
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
        let _ = storage::set_language_code(conn, track_id, code, false);
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
