//! Edit Process: paste > LRCLIB id > tags > Whisper, then single-doc translate.

use std::path::Path;

use tauri::{AppHandle, Emitter};

use crate::lrclib;
use crate::sidecar;
use crate::storage::{self, Track};

use super::core::{self, LanguagePolicy};
use super::metadata::{read_file_metadata, split_lyric_lines};
use super::{bump_preview_generation, PipelineFailed};

/// Commit lyrics: pasted text, then LRCLIB id, then embedded tags, then Whisper.
pub fn process_lyrics(
    app: &AppHandle,
    track_id: i64,
    pasted: Option<String>,
    lrclib_id: Option<i64>,
) -> Result<Track, String> {
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
        return Err(
            "No lyrics found. Paste lyrics, pick a search match, or try Process again.".to_string(),
        );
    }

    let language_code = core::persist_and_resolve_language(
        &conn,
        track_id,
        &lyric_lines,
        source,
        LanguagePolicy::RespectManual,
        &track,
        meta.title.as_deref(),
        meta.artist.as_deref(),
        meta.album.as_deref(),
        whisper_language,
    )?;

    // Soft-fail: originals already saved; translation errors do not fail Process.
    let _ = core::translate_one(&conn, track_id, &lyric_lines, language_code.as_deref());

    storage::get_track_by_id(&conn, track_id)?
        .ok_or_else(|| format!("track missing after pipeline: {track_id}"))
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
