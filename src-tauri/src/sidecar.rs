//! HTTP client for the local Python FastAPI sidecar (localhost only).

use serde::{Deserialize, Serialize};
use std::time::Duration;
use ureq::Agent;

const BASE_URL: &str = "http://127.0.0.1:8765";

#[derive(Serialize)]
struct TranscribeRequest {
    file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    album: Option<String>,
}

#[derive(Deserialize)]
struct TranscribeLine {
    text: String,
    timestamp_ms: Option<i64>,
}

#[derive(Deserialize)]
struct TranscribeResponse {
    lines: Vec<TranscribeLine>,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Serialize)]
struct DetectLanguageRequest {
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
}

#[derive(Deserialize)]
struct DetectLanguageResponse {
    language: String,
}

pub struct TranscribeResult {
    pub lines: Vec<(Option<i64>, String)>,
    pub language: Option<String>,
}

fn agent() -> Agent {
    Agent::config_builder()
        // Whisper on CPU can take several minutes for a full song.
        .timeout_global(Some(Duration::from_secs(600)))
        .build()
        .into()
}

/// Ask the sidecar to transcribe a local audio file into lyric lines.
pub fn transcribe(
    file_path: &str,
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
) -> Result<TranscribeResult, String> {
    let request = TranscribeRequest {
        file_path: file_path.to_string(),
        title: title.map(str::to_string),
        artist: artist.map(str::to_string),
        album: album.map(str::to_string),
    };

    let response = agent()
        .post(&format!("{BASE_URL}/transcribe"))
        .send_json(&request)
        .map_err(|e| {
            format!("Transcription failed (is `npm run sidecar:dev` running?): {e}")
        })?;

    let body: TranscribeResponse = response
        .into_body()
        .read_json()
        .map_err(|e| format!("Invalid sidecar response: {e}"))?;

    Ok(TranscribeResult {
        lines: body
            .lines
            .into_iter()
            .map(|line| (line.timestamp_ms, line.text.trim().to_string()))
            .filter(|(_, text)| !text.is_empty())
            .collect(),
        language: body.language.filter(|code| !code.trim().is_empty()),
    })
}

/// Classify language from lyrics text via the sidecar.
pub fn detect_language(
    text: &str,
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    file_path: Option<&str>,
) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("no text for language detection".to_string());
    }

    let request = DetectLanguageRequest {
        text: trimmed.to_string(),
        title: title.map(str::to_string),
        artist: artist.map(str::to_string),
        album: album.map(str::to_string),
        file_path: file_path.map(str::to_string),
    };

    let response = agent()
        .post(&format!("{BASE_URL}/detect-language"))
        .send_json(&request)
        .map_err(|e| {
            format!("Language detection failed (is `npm run sidecar:dev` running?): {e}")
        })?;

    let body: DetectLanguageResponse = response
        .into_body()
        .read_json()
        .map_err(|e| format!("Invalid sidecar response: {e}"))?;

    let language = body.language.trim().to_lowercase();
    if language.is_empty() {
        return Err("empty language code from sidecar".to_string());
    }
    Ok(language)
}
