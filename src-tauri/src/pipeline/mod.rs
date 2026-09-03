//! Per-song processing pipeline: upload auto-pipeline, Edit Process, select-time detect.

mod core;
mod metadata;
mod preview;
mod process;
mod upload;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};

use crate::lrclib::LyricsMatch;
use crate::storage::Track;

pub use preview::{
    spawn_preview_lrclib_language, spawn_search_lyrics, spawn_set_track_language,
};
pub use process::spawn_process_lyrics;
pub use upload::process_uploads;

/// Per-track generation so stale select-time detect results do not overwrite newer work.
fn preview_generations() -> &'static Mutex<HashMap<i64, u64>> {
    static MAP: OnceLock<Mutex<HashMap<i64, u64>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn bump_preview_generation(track_id: i64) -> u64 {
    let mut map = preview_generations()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let entry = map.entry(track_id).or_insert(0);
    *entry = entry.wrapping_add(1);
    *entry
}

pub(crate) fn preview_generation_matches(track_id: i64, gen: u64) -> bool {
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

/// Per-track phase for upload auto-pipeline (and UI status labels).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelinePhaseEvent {
    pub track_id: i64,
    /// importing | searching | transcribing | translating | ready | failed
    pub phase: String,
    pub message: Option<String>,
}

pub(crate) fn emit_phase(app: &AppHandle, track_id: i64, phase: &str, message: Option<String>) {
    let _ = app.emit(
        "pipeline-phase",
        &PipelinePhaseEvent {
            track_id,
            phase: phase.to_string(),
            message,
        },
    );
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsSearchFinished {
    pub track_id: i64,
    pub query: Option<String>,
    pub matches: Vec<LyricsMatch>,
    /// Closest LRCLIB match within ±1s of track duration, if any.
    pub preferred_match_id: Option<i64>,
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
