mod pipeline;
mod playback;
mod sidecar;
mod storage;

use serde::Serialize;
use tauri::AppHandle;

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

/// Accepts a local file path from the UI, saves track + lyrics, returns the track.
#[tauri::command]
fn process_upload(app: AppHandle, file_path: String) -> Result<Track, String> {
    let conn = storage::open(&app)?;
    pipeline::process_upload(&conn, &file_path)
}

#[tauri::command]
fn list_tracks(app: AppHandle) -> Result<Vec<Track>, String> {
    let conn = storage::open(&app)?;
    storage::list_tracks(&conn)
}

#[tauri::command]
fn get_lyrics(app: AppHandle, track_id: i64) -> Result<Vec<LyricLine>, String> {
    let conn = storage::open(&app)?;
    storage::get_lyrics(&conn, track_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            process_upload,
            list_tracks,
            get_lyrics
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
