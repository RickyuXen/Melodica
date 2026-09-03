//! Audio file metadata and lyric text parsing helpers.

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::read_from_path;
use lofty::tag::{Accessor, ItemKey};
use std::path::Path;

use crate::lrclib::LyricsMatch;

/// Duration window (seconds) for auto-selecting an LRCLIB match against track length.
const DURATION_MATCH_TOLERANCE_SECS: f64 = 1.0;

#[derive(Clone)]
pub(crate) struct FileMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_ms: Option<i64>,
    pub lyric_lines: Vec<(Option<i64>, String)>,
}

/// Pick the closest LRCLIB match within ±1s of track duration.
/// Missing track or match duration → no pick. Ties keep earlier API order.
pub fn select_lrclib_by_duration(
    track_duration_ms: Option<i64>,
    matches: &[LyricsMatch],
) -> Option<&LyricsMatch> {
    let track_ms = track_duration_ms.filter(|ms| *ms > 0)?;
    let track_sec = track_ms as f64 / 1000.0;

    let mut best: Option<(f64, usize, &LyricsMatch)> = None;
    for (idx, candidate) in matches.iter().enumerate() {
        let Some(match_sec) = candidate.duration_seconds.filter(|d| *d > 0.0) else {
            continue;
        };
        let delta = (track_sec - match_sec).abs();
        if delta > DURATION_MATCH_TOLERANCE_SECS {
            continue;
        }
        match best {
            None => best = Some((delta, idx, candidate)),
            Some((best_delta, best_idx, _)) => {
                if delta < best_delta || ((delta - best_delta).abs() < f64::EPSILON && idx < best_idx)
                {
                    best = Some((delta, idx, candidate));
                }
            }
        }
    }
    best.map(|(_, _, m)| m)
}

pub(crate) fn read_file_metadata(path: &Path) -> FileMetadata {
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
pub(crate) fn split_lyric_lines(text: &str) -> Vec<(Option<i64>, String)> {
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
