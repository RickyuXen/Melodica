//! HTTP client for the local Python FastAPI sidecar (localhost only).

use serde::{Deserialize, Serialize};
use std::time::Duration;
use ureq::Agent;

use crate::storage::{LineTranslation, WordGloss};

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TranslateAlignRequest {
    target_language: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_language: Option<String>,
    documents: Vec<TranslateDocumentIn>,
    #[serde(skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TranslateDocumentIn {
    id: String,
    lines: Vec<TranslateLineIn>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TranslateLineIn {
    line_index: i64,
    original: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslateAlignResponse {
    documents: Vec<TranslateDocumentOut>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslateDocumentOut {
    id: String,
    lines: Vec<TranslateLineOut>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslateLineOut {
    line_index: i64,
    sense: String,
    words: Vec<WordGlossOut>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WordGlossOut {
    text: String,
    gloss: String,
}

pub struct TranscribeResult {
    pub lines: Vec<(Option<i64>, String)>,
    pub language: Option<String>,
}

pub struct TranslateCredentials {
    pub api_key: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

fn agent() -> Agent {
    Agent::config_builder()
        // Whisper on CPU / LLM translate can take several minutes.
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

/// Translate one or more lyrics documents (same source language) into the target.
///
/// Accepts multiple documents so future multi-song upload can batch same-language
/// tracks into fewer provider calls. v1 callers pass a single document with all lines.
pub fn translate_align(
    document_id: &str,
    lines: &[(i64, &str)],
    target_language: &str,
    source_language: Option<&str>,
    credentials: &TranslateCredentials,
) -> Result<Vec<LineTranslation>, String> {
    if lines.is_empty() {
        return Ok(Vec::new());
    }

    let request = TranslateAlignRequest {
        target_language: target_language.to_string(),
        source_language: source_language.map(str::to_string),
        documents: vec![TranslateDocumentIn {
            id: document_id.to_string(),
            lines: lines
                .iter()
                .map(|(line_index, original)| TranslateLineIn {
                    line_index: *line_index,
                    original: (*original).to_string(),
                })
                .collect(),
        }],
        api_key: Some(credentials.api_key.clone()),
        base_url: credentials.base_url.clone(),
        model: credentials.model.clone(),
    };

    let response = agent()
        .post(&format!("{BASE_URL}/translate-align"))
        .send_json(&request)
        .map_err(|e| {
            format!("Translation failed (is `npm run sidecar:dev` running?): {e}")
        })?;

    let status = response.status();
    if !status.is_success() {
        let detail = response
            .into_body()
            .read_to_string()
            .unwrap_or_else(|_| status.to_string());
        return Err(format!("Translation failed ({status}): {detail}"));
    }

    let body: TranslateAlignResponse = response
        .into_body()
        .read_json()
        .map_err(|e| format!("Invalid translate-align response: {e}"))?;

    let doc = body
        .documents
        .into_iter()
        .find(|d| d.id == document_id)
        .ok_or_else(|| "translate-align returned no matching document".to_string())?;

    Ok(doc
        .lines
        .into_iter()
        .map(|line| LineTranslation {
            line_index: line.line_index,
            translated_text: line.sense.trim().to_string(),
            word_glosses: line
                .words
                .into_iter()
                .map(|w| WordGloss {
                    text: w.text,
                    gloss: w.gloss,
                })
                .collect(),
        })
        .filter(|line| !line.translated_text.is_empty() || !line.word_glosses.is_empty())
        .collect())
}
