//! Upload auto-pipeline: duration-matched LRCLIB → tags → Whisper, then translate batch.

use std::path::Path;

use tauri::{AppHandle, Emitter};

use crate::lrclib;
use crate::sidecar;
use crate::storage::{self, Track};

use super::core::{self, AcquiredLyrics, LanguagePolicy};
use super::metadata::{read_file_metadata, select_lrclib_by_duration, FileMetadata};
use super::{
    bump_preview_generation, emit_phase, PipelineFailed,
};

enum AcquireOutcome {
    Ready(AcquiredLyrics),
    NeedWhisper {
        track_id: i64,
        file_path: String,
        title: String,
        artist: Option<String>,
        album: Option<String>,
    },
    Failed {
        track_id: i64,
        message: String,
    },
}

/// Fast path: validate the file, save metadata, and store embedded lyrics if present.
/// Outside the Pipeline core (import UX); auto-pipeline may overwrite later.
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
        core::apply_detected_language(
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

/// Upsert each path, then spawn the full auto-pipeline (lyrics + batched translate).
pub fn process_uploads(app: &AppHandle, file_paths: Vec<String>) -> Result<Vec<Track>, String> {
    if file_paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut tracks = Vec::new();
    for path in &file_paths {
        match begin_upload(app, path) {
            Ok(track) => {
                emit_phase(app, track.id, "importing", None);
                tracks.push(track);
            }
            Err(message) => {
                let _ = app.emit(
                    "pipeline-failed",
                    &PipelineFailed {
                        track_id: 0,
                        message: format!("{path}: {message}"),
                    },
                );
            }
        }
    }

    let track_ids: Vec<i64> = tracks.iter().map(|t| t.id).collect();
    if !track_ids.is_empty() {
        spawn_auto_pipeline(app.clone(), track_ids);
    }
    Ok(tracks)
}

/// Spawn upload auto-pipeline for already-upserted track ids.
pub fn spawn_auto_pipeline(app: AppHandle, track_ids: Vec<i64>) {
    std::thread::spawn(move || {
        run_auto_pipeline(&app, track_ids);
    });
}

fn run_auto_pipeline(app: &AppHandle, track_ids: Vec<i64>) {
    let mut handles = Vec::with_capacity(track_ids.len());
    for track_id in track_ids {
        let app = app.clone();
        handles.push(std::thread::spawn(move || acquire_lyrics_non_whisper(&app, track_id)));
    }

    let mut acquired: Vec<AcquiredLyrics> = Vec::new();
    let mut need_whisper = Vec::new();

    for handle in handles {
        match handle.join() {
            Ok(AcquireOutcome::Ready(item)) => acquired.push(item),
            Ok(AcquireOutcome::NeedWhisper {
                track_id,
                file_path,
                title,
                artist,
                album,
            }) => need_whisper.push((track_id, file_path, title, artist, album)),
            Ok(AcquireOutcome::Failed { track_id, message }) => {
                emit_phase(app, track_id, "failed", Some(message.clone()));
                let _ = app.emit(
                    "pipeline-failed",
                    &PipelineFailed { track_id, message },
                );
            }
            Err(_) => {}
        }
    }

    for (track_id, file_path, title, artist, album) in need_whisper {
        emit_phase(app, track_id, "transcribing", None);
        match acquire_via_whisper(app, track_id, &file_path, &title, artist.as_deref(), album.as_deref())
        {
            Ok(item) => acquired.push(item),
            Err(message) => {
                emit_phase(app, track_id, "failed", Some(message.clone()));
                let _ = app.emit(
                    "pipeline-failed",
                    &PipelineFailed { track_id, message },
                );
            }
        }
    }

    batch_translate_acquired(app, &acquired);
}

fn acquire_lyrics_non_whisper(app: &AppHandle, track_id: i64) -> AcquireOutcome {
    let _ = bump_preview_generation(track_id);
    emit_phase(app, track_id, "searching", None);

    let conn = match storage::open(app) {
        Ok(c) => c,
        Err(message) => return AcquireOutcome::Failed { track_id, message },
    };
    let track = match storage::get_track_by_id(&conn, track_id) {
        Ok(Some(t)) => t,
        Ok(None) => {
            return AcquireOutcome::Failed {
                track_id,
                message: format!("track not found: {track_id}"),
            };
        }
        Err(message) => return AcquireOutcome::Failed { track_id, message },
    };

    let path = Path::new(&track.file_path);
    if !path.is_file() {
        return AcquireOutcome::Failed {
            track_id,
            message: format!("file not found: {}", track.file_path),
        };
    }
    let meta = read_file_metadata(path);

    let matches = match lrclib::search_track(&track.title, track.artist.as_deref()) {
        Ok(m) => m,
        Err(_) => Vec::new(),
    };

    if let Some(chosen) = select_lrclib_by_duration(track.duration_ms.or(meta.duration_ms), &matches)
    {
        match lrclib::lyrics_for_id(chosen.id) {
            Ok(text) => {
                let lyric_lines = super::metadata::split_lyric_lines(&text);
                if !lyric_lines.is_empty() {
                    return finalize_acquired(
                        app,
                        track_id,
                        &track,
                        &meta,
                        lyric_lines,
                        "lrclib",
                        None,
                    );
                }
            }
            Err(_) => {}
        }
    }

    if !meta.lyric_lines.is_empty() {
        return finalize_acquired(
            app,
            track_id,
            &track,
            &meta,
            meta.lyric_lines.clone(),
            "embedded",
            None,
        );
    }

    AcquireOutcome::NeedWhisper {
        track_id,
        file_path: track.file_path.clone(),
        title: track.title.clone(),
        artist: track.artist.clone(),
        album: track.album.clone(),
    }
}

fn acquire_via_whisper(
    app: &AppHandle,
    track_id: i64,
    file_path: &str,
    title: &str,
    artist: Option<&str>,
    album: Option<&str>,
) -> Result<AcquiredLyrics, String> {
    let conn = storage::open(app)?;
    let track = storage::get_track_by_id(&conn, track_id)?
        .ok_or_else(|| format!("track not found: {track_id}"))?;
    let path = Path::new(file_path);
    let meta = read_file_metadata(path);

    let asr = sidecar::transcribe(
        file_path,
        meta.title.as_deref().or(Some(title)),
        meta.artist.as_deref().or(artist),
        meta.album.as_deref().or(album),
    )?;
    if asr.lines.is_empty() {
        return Err("No lyrics found via transcription.".to_string());
    }

    match finalize_acquired(
        app,
        track_id,
        &track,
        &meta,
        asr.lines,
        "asr",
        asr.language,
    ) {
        AcquireOutcome::Ready(item) => Ok(item),
        AcquireOutcome::Failed { message, .. } => Err(message),
        AcquireOutcome::NeedWhisper { .. } => Err("Unexpected whisper requeue".to_string()),
    }
}

fn finalize_acquired(
    app: &AppHandle,
    track_id: i64,
    track: &Track,
    meta: &FileMetadata,
    lyric_lines: Vec<(Option<i64>, String)>,
    source: &str,
    whisper_language: Option<String>,
) -> AcquireOutcome {
    let conn = match storage::open(app) {
        Ok(c) => c,
        Err(message) => return AcquireOutcome::Failed { track_id, message },
    };

    match core::persist_and_resolve_language(
        &conn,
        track_id,
        &lyric_lines,
        source,
        LanguagePolicy::ForceAutoDetect,
        track,
        meta.title.as_deref(),
        meta.artist.as_deref(),
        meta.album.as_deref(),
        whisper_language,
    ) {
        Ok(language_code) => AcquireOutcome::Ready(AcquiredLyrics {
            track_id,
            lyric_lines,
            language_code,
        }),
        Err(message) => AcquireOutcome::Failed { track_id, message },
    }
}

fn batch_translate_acquired(app: &AppHandle, acquired: &[AcquiredLyrics]) {
    if acquired.is_empty() {
        return;
    }

    let conn = match storage::open(app) {
        Ok(c) => c,
        Err(message) => {
            for item in acquired {
                emit_phase(app, item.track_id, "failed", Some(message.clone()));
                let _ = app.emit(
                    "pipeline-failed",
                    &PipelineFailed {
                        track_id: item.track_id,
                        message: message.clone(),
                    },
                );
            }
            return;
        }
    };

    core::translate_batch(
        &conn,
        acquired,
        |track_id| emit_phase(app, track_id, "translating", None),
        |track_id| finish_track_ready(app, track_id),
    );
}

fn finish_track_ready(app: &AppHandle, track_id: i64) {
    emit_phase(app, track_id, "ready", None);
    if let Ok(conn) = storage::open(app) {
        if let Ok(Some(track)) = storage::get_track_by_id(&conn, track_id) {
            let _ = app.emit("pipeline-finished", &track);
            return;
        }
    }
    let _ = app.emit(
        "pipeline-failed",
        &PipelineFailed {
            track_id,
            message: format!("track missing after pipeline: {track_id}"),
        },
    );
}
