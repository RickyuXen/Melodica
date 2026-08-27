# ADR 003: Select-time language detect vs Process-only lyrics and translation

## Status

Accepted

## Context

Edit already searched LRCLIB and let the user pick a match, but language detection and translation waited for Process. Users need to see the auto-detected language (and override it) before committing lyrics. Changing Song language used to clear translations and re-run translate-align immediately, which conflated preference with Process.

## Decision

- **Select-time detect:** When the user selects an LRCLIB match (including duration-matched auto-select within ±1s), fetch that match’s lyrics text and run language detection. Write `tracks.language_code` with `language_manual=false`. Do **not** persist lyrics to `lyrics_cache`.
- **Show** the detected code in Song language as “(detected)” plus an “Auto-detected: …” hint. Soft-fail empty/instrumental/detect errors with a muted/error hint; do not block Edit or Process.
- **Manual override** sets `language_manual=true` and must not run Process, save lyrics, or translate. Manual wins over in-flight select-time detect.
- **Auto-detect** in the picker clears manual/code; if a match is selected, re-runs select-time fetch+detect. Otherwise leave empty until Process.
- **Match change / “None”:** If not manual, clear `language_code` until a new detect finishes (or leave empty for “None”).
- **Process** remains the only step that saves lyrics and runs translation: resolve source (paste > LRCLIB > tags > Whisper) → `replace_lyrics` → re-detect when not manual → `translate-align` (soft-fail). Paste does not get select-time detect.
- **Races:** Per-track generation tokens; stale select-time results no-op. Process and manual set bump generation. Process does not wait on select-time detect.
- **v1:** No Edit preview of fetched-but-unpersisted LRCLIB text.

## Consequences

- New Tauri command `preview_lrclib_language` and events `language-preview-finished` / `language-preview-failed`.
- `set_track_language` is preference-only (optional LRCLIB id on Auto for re-detect); it no longer clears or regenerates translations.
- ADR 002’s Process-time translate-align path stays; Edit language changes no longer imply retranslation.
- Glossary: select-time detection; plan/flow/PRODUCT updated to match.
