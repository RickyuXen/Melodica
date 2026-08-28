mod lrclib;
mod pipeline;
mod playback;
mod sidecar;
mod storage;

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};

use playback::{PlaybackStatus, SharedPlayback};
use storage::{LyricLine, Track};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

/// Confirms the UI ↔ Rust IPC bridge is working.
#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: env!("CARGO_PKG_NAME").to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Accepts a local file path from the UI, saves track metadata, then runs the
/// full auto-pipeline (lyrics + translation) in the background.
#[tauri::command]
fn process_upload(app: AppHandle, file_path: String) -> Result<Track, String> {
    let tracks = pipeline::process_uploads(&app, vec![file_path])?;
    tracks
        .into_iter()
        .next()
        .ok_or_else(|| "Upload failed".to_string())
}

/// Accepts one or more local file paths; upserts each and runs the upload auto-pipeline.
#[tauri::command]
fn process_uploads(app: AppHandle, file_paths: Vec<String>) -> Result<Vec<Track>, String> {
    pipeline::process_uploads(&app, file_paths)
}

#[tauri::command]
fn search_lyrics(
    app: AppHandle,
    track_id: i64,
    query: Option<String>,
) -> Result<(), String> {
    let conn = storage::open(&app)?;
    if storage::get_track_by_id(&conn, track_id)?.is_none() {
        return Err(format!("track not found: {track_id}"));
    }
    pipeline::spawn_search_lyrics(app, track_id, query);
    Ok(())
}

/// Starts lyrics processing on a background thread (paste > LRCLIB > tags > Whisper).
#[tauri::command]
fn process_lyrics(
    app: AppHandle,
    track_id: i64,
    pasted: Option<String>,
    lrclib_id: Option<i64>,
) -> Result<(), String> {
    let conn = storage::open(&app)?;
    if storage::get_track_by_id(&conn, track_id)?.is_none() {
        return Err(format!("track not found: {track_id}"));
    }
    pipeline::spawn_process_lyrics(app, track_id, pasted, lrclib_id);
    Ok(())
}

/// Set or clear song language from Edit. Pass null/empty for auto-detect.
/// Preference only (no translation). Optional lrclib_id re-runs select-time detect on Auto.
/// Emits pipeline-finished/failed; Auto+match also emits language-preview-finished.
#[tauri::command]
fn set_track_language(
    app: AppHandle,
    track_id: i64,
    language_code: Option<String>,
    lrclib_id: Option<i64>,
) -> Result<(), String> {
    let conn = storage::open(&app)?;
    if storage::get_track_by_id(&conn, track_id)?.is_none() {
        return Err(format!("track not found: {track_id}"));
    }
    pipeline::spawn_set_track_language(app, track_id, language_code, lrclib_id);
    Ok(())
}

/// Select-time LRCLIB fetch + language detect (no lyrics persist). Soft-fails via events.
#[tauri::command]
fn preview_lrclib_language(
    app: AppHandle,
    track_id: i64,
    lrclib_id: Option<i64>,
) -> Result<(), String> {
    let conn = storage::open(&app)?;
    if storage::get_track_by_id(&conn, track_id)?.is_none() {
        return Err(format!("track not found: {track_id}"));
    }
    pipeline::spawn_preview_lrclib_language(app, track_id, lrclib_id);
    Ok(())
}

#[tauri::command]
fn list_tracks(app: AppHandle) -> Result<Vec<Track>, String> {
    let conn = storage::open(&app)?;
    storage::list_tracks(&conn)
}

/// Clears all tracks/lyrics (and related rows) and stops playback.
#[tauri::command]
fn reset_database(
    app: AppHandle,
    engine: State<'_, SharedPlayback>,
) -> Result<(), String> {
    let conn = storage::open(&app)?;
    storage::reset_database(&conn)?;

    let mut guard = engine
        .lock()
        .map_err(|_| "playback state poisoned".to_string())?;
    if let Some(player) = guard.as_mut() {
        player.stop();
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateApiKeyStatus {
    pub has_key: bool,
}

/// Returns whether a Settings-stored translation API key exists (never the key).
#[tauri::command]
fn get_translate_api_key_status(app: AppHandle) -> Result<TranslateApiKeyStatus, String> {
    let conn = storage::open(&app)?;
    Ok(TranslateApiKeyStatus {
        has_key: storage::get_translate_api_key(&conn)?.is_some(),
    })
}

/// Save or clear the Settings translation API key (overrides MELODICA_TRANSLATE_API_KEY).
#[tauri::command]
fn set_translate_api_key(app: AppHandle, api_key: Option<String>) -> Result<TranslateApiKeyStatus, String> {
    let conn = storage::open(&app)?;
    storage::set_translate_api_key(&conn, api_key.as_deref())?;
    Ok(TranslateApiKeyStatus {
        has_key: storage::get_translate_api_key(&conn)?.is_some(),
    })
}

#[tauri::command]
fn get_lyrics(app: AppHandle, track_id: i64) -> Result<Vec<LyricLine>, String> {
    let conn = storage::open(&app)?;
    storage::get_lyrics(&conn, track_id)
}

#[tauri::command]
fn playback_play(
    app: AppHandle,
    engine: State<'_, SharedPlayback>,
    track_id: i64,
) -> Result<PlaybackStatus, String> {
    let conn = storage::open(&app)?;
    let track = storage::get_track_by_id(&conn, track_id)?
        .ok_or_else(|| format!("track not found: {track_id}"))?;

    playback::with_engine(&engine, |player| {
        player.play_file(track.id, &track.file_path, track.duration_ms)
    })
}

#[tauri::command]
fn playback_toggle(engine: State<'_, SharedPlayback>) -> Result<PlaybackStatus, String> {
    playback::with_engine(&engine, |player| Ok(player.toggle()))
}

#[tauri::command]
fn playback_seek(
    engine: State<'_, SharedPlayback>,
    position_ms: u64,
) -> Result<PlaybackStatus, String> {
    playback::with_engine(&engine, |player| player.seek(position_ms))
}

#[tauri::command]
fn playback_status(engine: State<'_, SharedPlayback>) -> Result<PlaybackStatus, String> {
    let guard = engine
        .lock()
        .map_err(|_| "playback state poisoned".to_string())?;

    Ok(match guard.as_ref() {
        Some(player) => player.status(),
        None => PlaybackStatus {
            track_id: None,
            playing: false,
            position_ms: 0,
            duration_ms: 0,
        },
    })
}

#[tauri::command]
fn set_volume(engine: State<'_, SharedPlayback>, volume: f32) -> Result<(), String> {
    playback::with_engine(&engine, |player| {
        player.set_volume(volume);
        Ok(())
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(None) as SharedPlayback)
        .invoke_handler(tauri::generate_handler![
            app_info,
            process_upload,
            process_uploads,
            search_lyrics,
            process_lyrics,
            set_track_language,
            preview_lrclib_language,
            list_tracks,
            reset_database,
            get_lyrics,
            get_translate_api_key_status,
            set_translate_api_key,
            playback_play,
            playback_toggle,
            playback_seek,
            playback_status,
            set_volume
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
