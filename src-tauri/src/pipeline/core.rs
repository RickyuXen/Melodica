//! Deep Pipeline core: persist lyrics, resolve language, translate (one or batch).

use std::collections::HashMap;

use rusqlite::Connection;

use crate::sidecar;
use crate::storage;

pub(crate) const DEFAULT_TARGET_LANGUAGE: &str = "en";

/// How Process vs upload auto-pipeline treat `language_manual`.
#[derive(Clone, Copy)]
pub(crate) enum LanguagePolicy {
    /// Edit Process: keep manual code; detect only when not manual.
    RespectManual,
    /// Upload auto-pipeline: clear manual, always auto-detect.
    ForceAutoDetect,
}

/// Lyrics acquired and language-resolved, ready for (batch) translate.
pub(crate) struct AcquiredLyrics {
    pub track_id: i64,
    pub lyric_lines: Vec<(Option<i64>, String)>,
    pub language_code: Option<String>,
}

pub(crate) fn primary_language_tag(code: &str) -> String {
    code.trim()
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn env_translate_api_key() -> Option<String> {
    // Release builds require a Settings key so downloaded apps never pick up a
    // developer's shell/.env credentials. Dev (`tauri:dev`) may use .env / env.
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var("MELODICA_TRANSLATE_API_KEY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub(crate) fn resolve_translate_credentials(
    conn: &Connection,
) -> Option<sidecar::TranslateCredentials> {
    let settings_key = storage::get_translate_api_key(conn).ok().flatten();
    let api_key = settings_key.or_else(env_translate_api_key)?;

    let base_url = std::env::var("MELODICA_TRANSLATE_BASE_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let model = std::env::var("MELODICA_TRANSLATE_MODEL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    Some(sidecar::TranslateCredentials {
        api_key,
        base_url,
        model,
    })
}

/// Persist originals, then resolve language per policy.
pub(crate) fn persist_and_resolve_language(
    conn: &Connection,
    track_id: i64,
    lyric_lines: &[(Option<i64>, String)],
    source: &str,
    language_policy: LanguagePolicy,
    track: &storage::Track,
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    whisper_language: Option<String>,
) -> Result<Option<String>, String> {
    storage::replace_lyrics(conn, track_id, lyric_lines, source)?;

    let language_code = match language_policy {
        LanguagePolicy::RespectManual if track.language_manual => track.language_code.clone(),
        LanguagePolicy::RespectManual => apply_detected_language(
            conn,
            track_id,
            lyric_lines,
            title.or(Some(track.title.as_str())),
            artist.or(track.artist.as_deref()),
            album.or(track.album.as_deref()),
            Some(&track.file_path),
            whisper_language,
        ),
        LanguagePolicy::ForceAutoDetect => {
            let _ = storage::clear_language_manual(conn, track_id);
            apply_detected_language(
                conn,
                track_id,
                lyric_lines,
                title.or(Some(track.title.as_str())),
                artist.or(track.artist.as_deref()),
                album.or(track.album.as_deref()),
                Some(&track.file_path),
                whisper_language,
            )
        }
    };

    Ok(language_code)
}

/// Single-document translate-align (Edit Process). Soft-fail at call site.
pub(crate) fn translate_one(
    conn: &Connection,
    track_id: i64,
    lyric_lines: &[(Option<i64>, String)],
    language_code: Option<&str>,
) -> Result<(), String> {
    let target = DEFAULT_TARGET_LANGUAGE;
    if let Some(code) = language_code {
        if primary_language_tag(code) == target {
            return Ok(());
        }
    }

    let credentials = resolve_translate_credentials(conn).ok_or_else(|| {
        if cfg!(debug_assertions) {
            "No translation API key. Set one in Settings or MELODICA_TRANSLATE_API_KEY."
                .to_string()
        } else {
            "No translation API key. Set one in Settings.".to_string()
        }
    })?;

    let indexed: Vec<(i64, &str)> = lyric_lines
        .iter()
        .enumerate()
        .map(|(i, (_, text))| (i as i64, text.as_str()))
        .collect();

    let translations = sidecar::translate_align(
        &track_id.to_string(),
        &indexed,
        target,
        language_code,
        &credentials,
    )?;

    if translations.is_empty() {
        return Err("Translation returned no lines".to_string());
    }

    storage::apply_line_translations(conn, track_id, &translations)
}

/// Group-by-language multi-document translate (upload auto-pipeline).
/// Invokes `on_translating` / `on_ready` for event policy; soft-fails translation.
pub(crate) fn translate_batch<FTranslating, FReady>(
    conn: &Connection,
    acquired: &[AcquiredLyrics],
    mut on_translating: FTranslating,
    mut on_ready: FReady,
) where
    FTranslating: FnMut(i64),
    FReady: FnMut(i64),
{
    if acquired.is_empty() {
        return;
    }

    let target = DEFAULT_TARGET_LANGUAGE;
    let mut groups: HashMap<String, Vec<&AcquiredLyrics>> = HashMap::new();
    for item in acquired {
        let key = item
            .language_code
            .as_deref()
            .map(primary_language_tag)
            .filter(|t| !t.is_empty())
            .unwrap_or_default();
        groups.entry(key).or_default().push(item);
    }

    let credentials = resolve_translate_credentials(conn);

    for (lang_key, group) in groups {
        if lang_key == target {
            for item in &group {
                on_ready(item.track_id);
            }
            continue;
        }

        for item in &group {
            on_translating(item.track_id);
        }

        let Some(ref creds) = credentials else {
            for item in &group {
                on_ready(item.track_id);
            }
            continue;
        };

        let source_language = if lang_key.is_empty() {
            None
        } else {
            Some(lang_key.as_str())
        };

        let documents: Vec<(String, Vec<(i64, String)>)> = group
            .iter()
            .map(|item| {
                let lines = item
                    .lyric_lines
                    .iter()
                    .enumerate()
                    .map(|(i, (_, text))| (i as i64, text.clone()))
                    .collect();
                (item.track_id.to_string(), lines)
            })
            .collect();

        match sidecar::translate_align_documents(&documents, target, source_language, creds) {
            Ok(translated) => {
                for doc in translated {
                    if let Ok(track_id) = doc.id.parse::<i64>() {
                        if !doc.lines.is_empty() {
                            let _ = storage::apply_line_translations(conn, track_id, &doc.lines);
                        }
                    }
                }
            }
            Err(_) => {
                // Soft-fail: keep originals for the whole language group.
            }
        }

        for item in &group {
            on_ready(item.track_id);
        }
    }
}

pub(crate) fn apply_detected_language(
    conn: &Connection,
    track_id: i64,
    lyric_lines: &[(Option<i64>, String)],
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    file_path: Option<&str>,
    whisper_language: Option<String>,
) -> Option<String> {
    if lyric_lines.is_empty() {
        if let Some(code) = whisper_language {
            let _ = storage::set_language_code(conn, track_id, &code, false);
            return Some(code);
        }
        return None;
    }

    let lyrics_text = lyric_lines
        .iter()
        .map(|(_, text)| text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let language = match sidecar::detect_language(
        &lyrics_text,
        title,
        artist,
        album,
        file_path,
    ) {
        Ok(code) => Some(code),
        Err(_) => whisper_language,
    };

    if let Some(ref code) = language {
        let _ = storage::set_language_code(conn, track_id, code, false);
    }
    language
}
