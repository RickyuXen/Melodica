//! SQLite library storage — schema from plan.md.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub file_path: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_ms: Option<i64>,
    pub language_code: Option<String>,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub id: i64,
    pub track_id: i64,
    pub line_index: i64,
    pub timestamp_ms: Option<i64>,
    pub original_text: String,
    pub translated_text: Option<String>,
    pub source: String,
}

pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create app data dir: {e}"))?;
    Ok(dir.join("melodica.db"))
}

pub fn open(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("open db: {e}"))?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            artist TEXT,
            album TEXT,
            duration_ms INTEGER,
            language_code TEXT,
            added_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS lyrics_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            line_index INTEGER NOT NULL,
            timestamp_ms INTEGER,
            original_text TEXT NOT NULL,
            translated_text TEXT,
            source TEXT NOT NULL,
            UNIQUE(track_id, line_index)
        );

        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            PRIMARY KEY (playlist_id, track_id)
        );

        CREATE TABLE IF NOT EXISTS play_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            played_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )
    .map_err(|e| format!("migrate: {e}"))?;
    Ok(())
}

/// Insert a track, or return the existing row if `file_path` is already stored.
pub fn upsert_track(
    conn: &Connection,
    file_path: &str,
    title: &str,
    artist: Option<&str>,
    album: Option<&str>,
) -> Result<Track, String> {
    if let Some(existing) = get_track_by_path(conn, file_path)? {
        conn.execute(
            "UPDATE tracks SET title = ?1, artist = ?2, album = ?3 WHERE id = ?4",
            params![title, artist, album, existing.id],
        )
        .map_err(|e| format!("update track: {e}"))?;
        return get_track_by_id(conn, existing.id)?
            .ok_or_else(|| "updated track missing".to_string());
    }

    conn.execute(
        "INSERT INTO tracks (file_path, title, artist, album) VALUES (?1, ?2, ?3, ?4)",
        params![file_path, title, artist, album],
    )
    .map_err(|e| format!("insert track: {e}"))?;

    let id = conn.last_insert_rowid();
    get_track_by_id(conn, id)?.ok_or_else(|| "inserted track missing".to_string())
}

/// Replace all cached lyric lines for a track.
pub fn replace_lyrics(
    conn: &Connection,
    track_id: i64,
    lines: &[(Option<i64>, String)],
    source: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM lyrics_cache WHERE track_id = ?1",
        params![track_id],
    )
    .map_err(|e| format!("clear lyrics: {e}"))?;

    let mut stmt = conn
        .prepare(
            "INSERT INTO lyrics_cache (track_id, line_index, timestamp_ms, original_text, source)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .map_err(|e| format!("prepare lyrics insert: {e}"))?;

    for (index, (timestamp_ms, text)) in lines.iter().enumerate() {
        stmt.execute(params![
            track_id,
            index as i64,
            timestamp_ms,
            text,
            source
        ])
        .map_err(|e| format!("insert lyric line: {e}"))?;
    }

    Ok(())
}

pub fn list_tracks(conn: &Connection) -> Result<Vec<Track>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, file_path, title, artist, album, duration_ms, language_code, added_at
             FROM tracks
             ORDER BY added_at DESC, id DESC",
        )
        .map_err(|e| format!("prepare list tracks: {e}"))?;

    let rows = stmt
        .query_map([], map_track)
        .map_err(|e| format!("list tracks: {e}"))?;

    let mut tracks = Vec::new();
    for row in rows {
        tracks.push(row.map_err(|e| format!("map track: {e}"))?);
    }
    Ok(tracks)
}

pub fn get_lyrics(conn: &Connection, track_id: i64) -> Result<Vec<LyricLine>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, track_id, line_index, timestamp_ms, original_text, translated_text, source
             FROM lyrics_cache
             WHERE track_id = ?1
             ORDER BY line_index ASC",
        )
        .map_err(|e| format!("prepare get lyrics: {e}"))?;

    let rows = stmt
        .query_map(params![track_id], |row| {
            Ok(LyricLine {
                id: row.get(0)?,
                track_id: row.get(1)?,
                line_index: row.get(2)?,
                timestamp_ms: row.get(3)?,
                original_text: row.get(4)?,
                translated_text: row.get(5)?,
                source: row.get(6)?,
            })
        })
        .map_err(|e| format!("get lyrics: {e}"))?;

    let mut lines = Vec::new();
    for row in rows {
        lines.push(row.map_err(|e| format!("map lyric: {e}"))?);
    }
    Ok(lines)
}

fn get_track_by_path(conn: &Connection, file_path: &str) -> Result<Option<Track>, String> {
    conn.query_row(
        "SELECT id, file_path, title, artist, album, duration_ms, language_code, added_at
         FROM tracks WHERE file_path = ?1",
        params![file_path],
        map_track,
    )
    .optional()
    .map_err(|e| format!("query track by path: {e}"))
}

fn get_track_by_id(conn: &Connection, id: i64) -> Result<Option<Track>, String> {
    conn.query_row(
        "SELECT id, file_path, title, artist, album, duration_ms, language_code, added_at
         FROM tracks WHERE id = ?1",
        params![id],
        map_track,
    )
    .optional()
    .map_err(|e| format!("query track by id: {e}"))
}

fn map_track(row: &rusqlite::Row<'_>) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get(0)?,
        file_path: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album: row.get(4)?,
        duration_ms: row.get(5)?,
        language_code: row.get(6)?,
        added_at: row.get(7)?,
    })
}

pub fn title_from_path(file_path: &str) -> String {
    Path::new(file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .or_else(|| {
            Path::new(file_path)
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| file_path.to_string())
}
