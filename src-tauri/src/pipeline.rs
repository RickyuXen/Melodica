//! Entry point for the per-song processing pipeline.

use lofty::file::TaggedFileExt;
use lofty::read_from_path;
use lofty::tag::{Accessor, ItemKey};
use rusqlite::Connection;
use std::path::Path;

use crate::sidecar;
use crate::storage::{self, Track};

/// Accept a local music file, persist the track + lyrics (embedded or ASR), return the track.
pub fn process_upload(conn: &Connection, file_path: &str) -> Result<Track, String> {
    let path = Path::new(file_path);
    if !path.is_file() {
        return Err(format!("file not found: {file_path}"));
    }

    let meta = read_file_metadata(path);
    let title = meta
        .title
        .unwrap_or_else(|| storage::title_from_path(file_path));

    let track = storage::upsert_track(
        conn,
        file_path,
        &title,
        meta.artist.as_deref(),
        meta.album.as_deref(),
    )?;

    if !meta.lyric_lines.is_empty() {
        storage::replace_lyrics(conn, track.id, &meta.lyric_lines, "embedded")?;
        return Ok(track);
    }

    // No embedded lyrics — fall back to local Whisper via the Python sidecar.
    let asr_lines = sidecar::transcribe(file_path)?;
    if !asr_lines.is_empty() {
        storage::replace_lyrics(conn, track.id, &asr_lines, "asr")?;
    }
    // If ASR returns nothing, leave any previous cache intact.

    Ok(track)
}

struct FileMetadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    lyric_lines: Vec<(Option<i64>, String)>,
}

fn read_file_metadata(path: &Path) -> FileMetadata {
    let Ok(tagged) = read_from_path(path) else {
        return FileMetadata {
            title: None,
            artist: None,
            album: None,
            lyric_lines: Vec::new(),
        };
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
