//! SQLite library storage — schema from docs/plan.md.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
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
    /// True when the user set language in Edit (Process must not overwrite).
    pub language_manual: bool,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordGloss {
    pub text: String,
    pub gloss: String,
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
    pub word_glosses: Option<Vec<WordGloss>>,
    pub source: String,
}

/// One line's translation payload written after Process.
#[derive(Debug, Clone)]
pub struct LineTranslation {
    pub line_index: i64,
    pub translated_text: String,
    pub word_glosses: Vec<WordGloss>,
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
            language_manual INTEGER NOT NULL DEFAULT 0,
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

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("migrate: {e}"))?;

    // Existing installs may lack word_glosses; ignore duplicate-column errors.
    let _ = conn.execute(
        "ALTER TABLE lyrics_cache ADD COLUMN word_glosses TEXT",
        [],
    );

    // Manual language override from Edit; ignore if column already exists.
    let _ = conn.execute(
        "ALTER TABLE tracks ADD COLUMN language_manual INTEGER NOT NULL DEFAULT 0",
        [],
    );

    Ok(())
}

/// Insert a track, or return the existing row if `file_path` is already stored.
pub fn upsert_track(
    conn: &Connection,
    file_path: &str,
    title: &str,
    artist: Option<&str>,
    album: Option<&str>,
    duration_ms: Option<i64>,
) -> Result<Track, String> {
    if let Some(existing) = get_track_by_path(conn, file_path)? {
        conn.execute(
            "UPDATE tracks SET title = ?1, artist = ?2, album = ?3, duration_ms = ?4 WHERE id = ?5",
            params![title, artist, album, duration_ms, existing.id],
        )
        .map_err(|e| format!("update track: {e}"))?;
        return get_track_by_id(conn, existing.id)?
            .ok_or_else(|| "updated track missing".to_string());
    }

    conn.execute(
        "INSERT INTO tracks (file_path, title, artist, album, duration_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![file_path, title, artist, album, duration_ms],
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

/// Write line sense + word glosses onto existing lyric rows (by line_index).
pub fn apply_line_translations(
    conn: &Connection,
    track_id: i64,
    translations: &[LineTranslation],
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "UPDATE lyrics_cache
             SET translated_text = ?1, word_glosses = ?2
             WHERE track_id = ?3 AND line_index = ?4",
        )
        .map_err(|e| format!("prepare translation update: {e}"))?;

    for item in translations {
        let glosses_json = serde_json::to_string(&item.word_glosses)
            .map_err(|e| format!("serialize word glosses: {e}"))?;
        stmt.execute(params![
            item.translated_text,
            glosses_json,
            track_id,
            item.line_index
        ])
        .map_err(|e| format!("update lyric translation: {e}"))?;
    }

    Ok(())
}

pub fn set_language_code(
    conn: &Connection,
    track_id: i64,
    language_code: &str,
    manual: bool,
) -> Result<(), String> {
    let updated = conn
        .execute(
            "UPDATE tracks SET language_code = ?1, language_manual = ?2 WHERE id = ?3",
            params![language_code, if manual { 1 } else { 0 }, track_id],
        )
        .map_err(|e| format!("update language: {e}"))?;

    if updated == 0 {
        return Err(format!("track not found: {track_id}"));
    }
    Ok(())
}

pub fn clear_language_manual(conn: &Connection, track_id: i64) -> Result<(), String> {
    let updated = conn
        .execute(
            "UPDATE tracks SET language_manual = 0 WHERE id = ?1",
            params![track_id],
        )
        .map_err(|e| format!("clear language manual: {e}"))?;

    if updated == 0 {
        return Err(format!("track not found: {track_id}"));
    }
    Ok(())
}

/// Clear `language_code` (used when switching LRCLIB matches before Process).
pub fn clear_language_code(conn: &Connection, track_id: i64) -> Result<(), String> {
    let updated = conn
        .execute(
            "UPDATE tracks SET language_code = NULL WHERE id = ?1",
            params![track_id],
        )
        .map_err(|e| format!("clear language code: {e}"))?;

    if updated == 0 {
        return Err(format!("track not found: {track_id}"));
    }
    Ok(())
}

const TRANSLATE_API_KEY: &str = "translate_api_key";

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("get setting: {e}"))
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| format!("set setting: {e}"))?;
    Ok(())
}

pub fn delete_setting(conn: &Connection, key: &str) -> Result<(), String> {
    conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])
        .map_err(|e| format!("delete setting: {e}"))?;
    Ok(())
}

pub fn get_translate_api_key(conn: &Connection) -> Result<Option<String>, String> {
    Ok(get_setting(conn, TRANSLATE_API_KEY)?
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty()))
}

pub fn set_translate_api_key(conn: &Connection, key: Option<&str>) -> Result<(), String> {
    match key.map(str::trim).filter(|s| !s.is_empty()) {
        Some(value) => set_setting(conn, TRANSLATE_API_KEY, value),
        None => delete_setting(conn, TRANSLATE_API_KEY),
    }
}

/// Wipe all library data and reset autoincrement counters so the DB is empty.
/// Preserves app_settings (API key, etc.).
pub fn reset_database(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        DELETE FROM play_history;
        DELETE FROM playlist_tracks;
        DELETE FROM playlists;
        DELETE FROM lyrics_cache;
        DELETE FROM tracks;
        DELETE FROM sqlite_sequence
          WHERE name IN (
            'play_history', 'playlist_tracks', 'playlists', 'lyrics_cache', 'tracks'
          );
        "#,
    )
    .map_err(|e| format!("reset database: {e}"))?;
    Ok(())
}

pub fn list_tracks(conn: &Connection) -> Result<Vec<Track>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, file_path, title, artist, album, duration_ms, language_code,
                    language_manual, added_at
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

fn first_track_in_library(conn: &Connection) -> Result<Option<Track>, String> {
    conn.query_row(
        "SELECT id, file_path, title, artist, album, duration_ms, language_code,
                language_manual, added_at
         FROM tracks
         ORDER BY added_at DESC, id DESC
         LIMIT 1",
        [],
        map_track,
    )
    .optional()
    .map_err(|e| format!("query first track: {e}"))
}

/// Next track in library order (`added_at DESC, id DESC`). Wraps to the first track at the end.
pub fn next_track_in_library(conn: &Connection, after_id: Option<i64>) -> Result<Option<Track>, String> {
    match after_id {
        None => first_track_in_library(conn),
        Some(id) => {
            let current = get_track_by_id(conn, id)?
                .ok_or_else(|| format!("track not found: {id}"))?;

            let next = conn
                .query_row(
                    "SELECT id, file_path, title, artist, album, duration_ms, language_code,
                            language_manual, added_at
                     FROM tracks
                     WHERE added_at < ?1 OR (added_at = ?1 AND id < ?2)
                     ORDER BY added_at DESC, id DESC
                     LIMIT 1",
                    params![current.added_at, current.id],
                    map_track,
                )
                .optional()
                .map_err(|e| format!("query next track: {e}"))?;

            match next {
                Some(track) => Ok(Some(track)),
                None => first_track_in_library(conn),
            }
        }
    }
}

fn last_track_in_library(conn: &Connection) -> Result<Option<Track>, String> {
    conn.query_row(
        "SELECT id, file_path, title, artist, album, duration_ms, language_code,
                language_manual, added_at
         FROM tracks
         ORDER BY added_at ASC, id ASC
         LIMIT 1",
        [],
        map_track,
    )
    .optional()
    .map_err(|e| format!("query last track: {e}"))
}

/// Previous track in library order (`added_at DESC, id DESC`). Wraps to the last track at the start.
pub fn previous_track_in_library(
    conn: &Connection,
    before_id: Option<i64>,
) -> Result<Option<Track>, String> {
    match before_id {
        None => last_track_in_library(conn),
        Some(id) => {
            let current = get_track_by_id(conn, id)?
                .ok_or_else(|| format!("track not found: {id}"))?;

            let previous = conn
                .query_row(
                    "SELECT id, file_path, title, artist, album, duration_ms, language_code,
                            language_manual, added_at
                     FROM tracks
                     WHERE added_at > ?1 OR (added_at = ?1 AND id > ?2)
                     ORDER BY added_at ASC, id ASC
                     LIMIT 1",
                    params![current.added_at, current.id],
                    map_track,
                )
                .optional()
                .map_err(|e| format!("query previous track: {e}"))?;

            match previous {
                Some(track) => Ok(Some(track)),
                None => last_track_in_library(conn),
            }
        }
    }
}

pub fn get_lyrics(conn: &Connection, track_id: i64) -> Result<Vec<LyricLine>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, track_id, line_index, timestamp_ms, original_text, translated_text,
                    word_glosses, source
             FROM lyrics_cache
             WHERE track_id = ?1
             ORDER BY line_index ASC",
        )
        .map_err(|e| format!("prepare get lyrics: {e}"))?;

    let rows = stmt
        .query_map(params![track_id], |row| {
            let glosses_raw: Option<String> = row.get(6)?;
            Ok(LyricLine {
                id: row.get(0)?,
                track_id: row.get(1)?,
                line_index: row.get(2)?,
                timestamp_ms: row.get(3)?,
                original_text: row.get(4)?,
                translated_text: row.get(5)?,
                word_glosses: parse_word_glosses(glosses_raw),
                source: row.get(7)?,
            })
        })
        .map_err(|e| format!("get lyrics: {e}"))?;

    let mut lines = Vec::new();
    for row in rows {
        lines.push(row.map_err(|e| format!("map lyric: {e}"))?);
    }
    Ok(lines)
}

fn parse_word_glosses(raw: Option<String>) -> Option<Vec<WordGloss>> {
    let raw = raw?.trim().to_string();
    if raw.is_empty() {
        return None;
    }
    serde_json::from_str(&raw).ok()
}

fn get_track_by_path(conn: &Connection, file_path: &str) -> Result<Option<Track>, String> {
    conn.query_row(
        "SELECT id, file_path, title, artist, album, duration_ms, language_code,
                language_manual, added_at
         FROM tracks WHERE file_path = ?1",
        params![file_path],
        map_track,
    )
    .optional()
    .map_err(|e| format!("query track by path: {e}"))
}

pub fn get_track_by_id(conn: &Connection, id: i64) -> Result<Option<Track>, String> {
    conn.query_row(
        "SELECT id, file_path, title, artist, album, duration_ms, language_code,
                language_manual, added_at
         FROM tracks WHERE id = ?1",
        params![id],
        map_track,
    )
    .optional()
    .map_err(|e| format!("query track by id: {e}"))
}

fn map_track(row: &rusqlite::Row<'_>) -> rusqlite::Result<Track> {
    let language_manual: i64 = row.get(7)?;
    Ok(Track {
        id: row.get(0)?,
        file_path: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album: row.get(4)?,
        duration_ms: row.get(5)?,
        language_code: row.get(6)?,
        language_manual: language_manual != 0,
        added_at: row.get(8)?,
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
