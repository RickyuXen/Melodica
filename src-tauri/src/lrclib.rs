//! LRCLIB HTTP client — search and fetch lyrics (no API key).

use serde::{Deserialize, Serialize};
use std::time::Duration;
use ureq::Agent;

const BASE_URL: &str = "https://lrclib.net/api";
const USER_AGENT: &str = concat!("Melodica/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsMatch {
    pub id: i64,
    pub track_name: String,
    pub artist_name: String,
    pub album_name: Option<String>,
    pub duration_seconds: Option<f64>,
    pub instrumental: bool,
    pub has_synced: bool,
    pub has_plain: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrclibRecord {
    id: i64,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    track_name: Option<String>,
    #[serde(default)]
    artist_name: Option<String>,
    #[serde(default)]
    album_name: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    plain_lyrics: Option<String>,
    #[serde(default)]
    synced_lyrics: Option<String>,
}

fn agent() -> Agent {
    Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(12)))
        .build()
        .into()
}

/// Keyword search (`q=`). Used when the user types their own query.
pub fn search_query(query: &str) -> Result<Vec<LyricsMatch>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let response = agent()
        .get(&format!("{BASE_URL}/search"))
        .header("User-Agent", USER_AGENT)
        .query("q", trimmed)
        .call()
        .map_err(|e| map_ureq(e, "LRCLIB search"))?;

    parse_search_body(response.into_body())
}

/// Structured search from file tags.
pub fn search_track(
    track_name: &str,
    artist_name: Option<&str>,
) -> Result<Vec<LyricsMatch>, String> {
    let title = track_name.trim();
    if title.is_empty() {
        return Ok(Vec::new());
    }

    let mut request = agent()
        .get(&format!("{BASE_URL}/search"))
        .header("User-Agent", USER_AGENT)
        .query("track_name", title);

    if let Some(artist) = artist_name.map(str::trim).filter(|s| !s.is_empty()) {
        request = request.query("artist_name", artist);
    }

    let response = request
        .call()
        .map_err(|e| map_ureq(e, "LRCLIB search"))?;

    parse_search_body(response.into_body())
}

/// Fetch one record by LRCLIB id. Prefers synced LRC, then plain text.
pub fn lyrics_for_id(id: i64) -> Result<String, String> {
    let response = agent()
        .get(&format!("{BASE_URL}/get/{id}"))
        .header("User-Agent", USER_AGENT)
        .call()
        .map_err(|e| map_ureq(e, "LRCLIB lyrics"))?;

    let mut body = response.into_body();
    let record: LrclibRecord = body
        .read_json()
        .map_err(|e| format!("Invalid LRCLIB response: {e}"))?;

    if record.instrumental {
        return Err("That match is instrumental and has no lyrics.".to_string());
    }

    pick_lyrics(&record)
        .ok_or_else(|| "That match has no lyrics text.".to_string())
}

fn parse_search_body(mut body: ureq::Body) -> Result<Vec<LyricsMatch>, String> {
    let records: Vec<LrclibRecord> = body
        .read_json()
        .map_err(|e| format!("Invalid LRCLIB search response: {e}"))?;

    Ok(records
        .into_iter()
        .map(into_match)
        .take(15)
        .collect())
}

fn into_match(record: LrclibRecord) -> LyricsMatch {
    let track_name = record
        .track_name
        .or(record.name)
        .unwrap_or_else(|| "Unknown title".to_string());
    let artist_name = record
        .artist_name
        .unwrap_or_else(|| "Unknown artist".to_string());
    let album_name = record
        .album_name
        .filter(|s| !s.trim().is_empty());
    let has_synced = nonempty(record.synced_lyrics.as_deref());
    let has_plain = nonempty(record.plain_lyrics.as_deref());

    LyricsMatch {
        id: record.id,
        track_name,
        artist_name,
        album_name,
        duration_seconds: record.duration.filter(|d| *d > 0.0),
        instrumental: record.instrumental,
        has_synced,
        has_plain,
    }
}

fn pick_lyrics(record: &LrclibRecord) -> Option<String> {
    if let Some(synced) = record.synced_lyrics.as_deref().map(str::trim) {
        if !synced.is_empty() {
            return Some(synced.to_string());
        }
    }
    record
        .plain_lyrics
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn nonempty(value: Option<&str>) -> bool {
    value.map(str::trim).is_some_and(|s| !s.is_empty())
}

fn map_ureq(err: ureq::Error, what: &str) -> String {
    match err {
        ureq::Error::StatusCode(404) => format!("{what} was not found."),
        ureq::Error::StatusCode(code) => format!("{what} failed (HTTP {code})."),
        other => format!("{what} failed: {other}"),
    }
}
