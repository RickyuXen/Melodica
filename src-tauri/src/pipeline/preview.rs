//! Select-time language detect, LRCLIB search, and Edit language preference.

use tauri::{AppHandle, Emitter};

use crate::lrclib::{self, LyricsMatch};
use crate::storage::{self, Track};

use super::core::apply_detected_language;
use super::metadata::{select_lrclib_by_duration, split_lyric_lines};
use super::{
    bump_preview_generation, preview_generation_matches, LanguagePreviewFailed,
    LanguagePreviewFinished, LyricsSearchFailed, LyricsSearchFinished, PipelineFailed,
};

/// Search LRCLIB off the UI thread and emit completion events.
pub fn spawn_search_lyrics(app: AppHandle, track_id: i64, query: Option<String>) {
    std::thread::spawn(move || {
        match search_lyrics(&app, track_id, query.clone()) {
            Ok((matches, preferred_match_id)) => {
                let _ = app.emit(
                    "lyrics-search-finished",
                    &LyricsSearchFinished {
                        track_id,
                        query,
                        matches,
                        preferred_match_id,
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

fn search_lyrics(
    app: &AppHandle,
    track_id: i64,
    query: Option<String>,
) -> Result<(Vec<LyricsMatch>, Option<i64>), String> {
    let conn = storage::open(app)?;
    let track = storage::get_track_by_id(&conn, track_id)?
        .ok_or_else(|| format!("track not found: {track_id}"))?;

    let custom = query
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let matches = if let Some(q) = custom {
        lrclib::search_query(q)?
    } else {
        lrclib::search_track(&track.title, track.artist.as_deref())?
    };
    let preferred_match_id = select_lrclib_by_duration(track.duration_ms, &matches).map(|m| m.id);
    Ok((matches, preferred_match_id))
}

/// Set or clear the song language from Edit. Empty/None = auto-detect mode.
/// Preference only: does not save lyrics or run translation (Process does that).
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
            // Re-detect from processed lyrics when present, else LRCLIB match text.
            preview_lrclib_language_with_gen(app, track_id, lrclib_id, gen)
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
        let is_auto = language_code
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.eq_ignore_ascii_case("auto"))
            .unwrap_or(true);
        match set_track_language(&app, track_id, language_code, lrclib_id) {
            Ok((track, warning)) => {
                let _ = app.emit("pipeline-finished", &track);
                if is_auto {
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

/// Select-time language preview: detect without persisting lyrics.
/// Prefers already-processed `lyrics_cache`; falls back to LRCLIB match text.
pub fn preview_lrclib_language(
    app: &AppHandle,
    track_id: i64,
    lrclib_id: Option<i64>,
) -> Result<(Track, Option<String>), String> {
    let gen = bump_preview_generation(track_id);
    preview_lrclib_language_with_gen(app, track_id, lrclib_id, gen)
}

fn language_already_set(track: &Track) -> bool {
    track
        .language_code
        .as_deref()
        .map(str::trim)
        .is_some_and(|c| !c.is_empty())
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

    // Keep any existing language (manual or prior auto-detect).
    if track.language_manual || language_already_set(&track) {
        return Ok((track, None));
    }

    // Prefer currently processed lyrics over an LRCLIB match preview.
    let cached = storage::get_lyrics(&conn, track_id)?;
    if !cached.is_empty() {
        if !preview_generation_matches(track_id, gen) {
            return Ok((track, None));
        }
        let lyric_lines: Vec<(Option<i64>, String)> = cached
            .iter()
            .map(|line| (line.timestamp_ms, line.original_text.clone()))
            .collect();
        return finish_language_detect(&conn, track_id, &lyric_lines, gen, "lyrics");
    }

    let Some(id) = lrclib_id else {
        return Ok((track, None));
    };

    let lyrics_text = match lrclib::lyrics_for_id(id) {
        Ok(text) => text,
        Err(message) => {
            if !preview_generation_matches(track_id, gen) {
                return Ok((track, None));
            }
            return Ok((track, Some(message)));
        }
    };

    let lyric_lines = split_lyric_lines(&lyrics_text);
    if lyric_lines.is_empty() {
        if !preview_generation_matches(track_id, gen) {
            return Ok((track, None));
        }
        return Ok((
            track,
            Some("That match has no usable lyrics text.".to_string()),
        ));
    }

    if !preview_generation_matches(track_id, gen) {
        return Ok((track, None));
    }

    finish_language_detect(&conn, track_id, &lyric_lines, gen, "match")
}

fn finish_language_detect(
    conn: &rusqlite::Connection,
    track_id: i64,
    lyric_lines: &[(Option<i64>, String)],
    gen: u64,
    source_label: &str,
) -> Result<(Track, Option<String>), String> {
    let current = storage::get_track_by_id(conn, track_id)?
        .ok_or_else(|| format!("track not found: {track_id}"))?;
    if current.language_manual || language_already_set(&current) {
        return Ok((current, None));
    }

    let detected = apply_detected_language(
        conn,
        track_id,
        lyric_lines,
        Some(current.title.as_str()),
        current.artist.as_deref(),
        current.album.as_deref(),
        Some(&current.file_path),
        None,
    );

    if !preview_generation_matches(track_id, gen) {
        return Ok((current, None));
    }

    let updated = storage::get_track_by_id(conn, track_id)?
        .ok_or_else(|| format!("track missing after language preview: {track_id}"))?;
    if updated.language_manual {
        return Ok((updated, None));
    }

    let warning = if detected.is_none() {
        Some(format!(
            "Could not detect language from that {source_label}."
        ))
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
