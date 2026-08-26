# ADR 002: Per-line word glosses and sentence sense

## Status

Accepted

## Context

Melodica’s product loop is study-while-listening: original lyrics plus English help on Home View lyrics. The schema already had `translated_text`, but generation was not shipped, and learners need both **per-word glosses under the original tokens** and a **full-sentence meaning** clearly separated. Tokenization for CJK and other scripts cannot rely on space-splitting. Translation may fail after originals are saved; Process must not wipe lyrics on LLM errors. Future multi-song upload should batch same-language tracks into fewer provider calls.

## Decision

- Run translation in the same **Process** job after originals are stored and language is detected.
- **Skip** when `primaryLanguageTag(language) == "en"` (target is parameterized; English only for now). Unknown/null language still attempts translation.
- Sidecar `POST /translate-align` with a **multi-document** request body; v1 sends one document containing **all lines**. The model returns ordered `{text, gloss}` tokens plus `sense` per line (no separate morphological analyzer).
- Persist `translated_text` (sense) and `word_glosses` (JSON array) on the same `lyrics_cache` row.
- **Soft-fail** translation: do not emit `pipeline-failed` for translation-only errors; Home shows originals plus a muted hint when a non-English track has no glosses/sense.
- UI study layout **only** on Home `LyricsDisplay` (Edit stays original-only). Karaoke highlight/seek remain whole-row.
- Provider is Google Gemini `generateContent` (Flash by default) behind a thin interface. API key: **Settings overrides `MELODICA_TRANSLATE_API_KEY`**. Key is stored in SQLite `app_settings`; the UI never re-reads the raw key (only `hasKey`).

## Consequences

- Rust, SQLite, sidecar, and Home UI all change; Edit preview does not show glosses.
- French (and other) Settings language options remain preferences until generation is wired.
- Multi-song upload UI can later group by language and reuse `translate-align` without a new endpoint.
- Word-level karaoke and end timestamps remain out of scope.
