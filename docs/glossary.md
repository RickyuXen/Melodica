# Melodica glossary

## Active line

The lyric line treated as “currently being sung” for karaoke highlight: the last line whose `timestampMs` is less than or equal to playback `positionMs`. Null-timestamp lines are ignored. Before the first timed line, there is no active line.

## Synced lyrics

A lyric set where at least one line has a non-null `timestampMs`. Only synced sets support karaoke highlight and seek-to-line.

## timestampMs

Optional start time of a lyric line in milliseconds from the beginning of the track. Stored on `lyrics_cache` / `LyricLine`. There is no end timestamp; a line stays active until the next timed line starts.

## Seek-to-line

User action (click or keyboard activate on a timed line button) that seeks playback to that line’s `timestampMs`, using the same path as the scrubber (play if needed → `playbackSeek`).

## Sidebar navigation

Vertical left nav (20% width) with Melodica branding, Home / Upload / Edit / Settings tabs (lucide icons), and Rust core connection status in the footer. Replaces the former horizontal header navbar.

## Now playing bar

Persistent player footer in the main column (80% width), visible on every tab. Holds previous / play-pause / next, seek slider, volume, and clickable track info. Clicking the track title navigates to Home and opens that song’s lyrics in the right pane.

## Home split view

Home tab layout: library list (left, 25% in split mode) and lyrics pane (right, 75%). Selecting a library row auto-plays the track and shows `LyricsDisplay` with karaoke highlight, seek-to-line, and the dual study translation layout. The library supports search, column sort (default title A→Z), and pane expand/contract controls.

## Library pane mode

Session-scoped layout for the Home or Edit split: `split` (default 25/75), `list-only` (full song list), or `lyrics-only` (lyrics/editor only). Controlled by toolbar buttons in the track list pane; resets on app launch.

## Track list sort

Frontend-only ordering of library rows by title, artist, or language. Default is title ascending. Clicking a column header sorts by that field; clicking the active column toggles ascending/descending. Does not affect playback next/prev order (still `added_at DESC` in the backend).

## Track list search

Filter above the library grid. Case-insensitive match against track title, artist, and human-readable language name. Empty results show “No matching songs.”

## View lyrics

Home surface for reading synced lyrics: select a track in the library list (left pane) or click the now playing bar track info. Renders `LyricsDisplay` in the right pane — the only surface with karaoke highlight, seek-to-line, and the dual study translation layout.

## Line sense

Full-sentence translation of one lyric line into the target language (English for now). Stored as `lyrics_cache.translated_text` / `LyricLine.translatedText`. Shown to the right of the word-gloss column on Home.

## Word gloss

Short target-language gloss for one token of the original line. Stored in `lyrics_cache.word_glosses` as JSON `[{ "text", "gloss" }, …]` and exposed as `LyricLine.wordGlosses`. Tokens are chosen by the translation model (not a separate tokenizer). Rendered directly under each original token.

## Primary language tag

The first subtag of a language code (`en-US` → `en`, `zh` → `zh`). Used to decide whether to skip translation when it equals the target (`en`), and to group tracks for a translate batch.

## Duration match (±1s)

Rule for auto-selecting an LRCLIB search hit: both the track’s `duration_ms` and the match’s `durationSeconds` must be present and positive, and `|trackSeconds − matchSeconds| ≤ 1.0`. Among hits in the window, pick the closest duration; equal deltas keep earlier LRCLIB API order. Missing duration on either side means that candidate (or the whole search) is not auto-selected. Used by upload auto-pipeline and Edit search (`preferredMatchId`).

## Upload auto-pipeline

Background job started when the user imports one or more audio files. For each track: upsert metadata → acquire lyrics (duration-matched LRCLIB → embedded tags → Whisper) → auto-detect language → after the whole set finishes acquisition, **translate batch** by language. Emits `pipeline-phase` / `pipeline-finished` / `pipeline-failed`. Soft-fails individual tracks. Re-uploading the same path re-runs the pipeline.

## translate batch

One sidecar `POST /translate-align` call with multiple `documents` (same source language) for an upload set. Tracks are grouped by primary language tag after acquisition; English groups are skipped; unknown/`null` language is one group with `sourceLanguage: null`. Edit Process still sends a single document.

## translate-align

Sidecar endpoint `POST /translate-align`. Accepts one or more lyrics **documents** of the same source language and returns per-line `sense` + `words` glosses.

## Translation API key

Credential for the Google Gemini LLM provider (Flash by default). Precedence: Settings-stored key (SQLite `app_settings`) overrides environment `MELODICA_TRANSLATE_API_KEY`. Optional `MELODICA_TRANSLATE_BASE_URL` and `MELODICA_TRANSLATE_MODEL` configure the Generative Language API endpoint and model (default `gemini-3.1-flash-lite`).

## Select-time detection

On Edit, when the user selects an LRCLIB matching song (including the duration-matched auto-select), Melodica fetches that match’s lyrics and runs language detection **without** writing `lyrics_cache`. The result is stored on `tracks.language_code` with `language_manual=false` and shown in Song language. Soft-fails leave the code empty and show a hint. Manual overrides are sticky until Auto-detect. Lyrics persist and translation run only on **Process** (or upload auto-pipeline).

## Process (lyrics pipeline)

Edit action that commits lyrics then translation: resolve source (paste > LRCLIB id > embedded tags > Whisper) → save originals to `lyrics_cache` → re-detect language when not manual → `translate-align` for non-English (soft-fail). Song language changes alone never Process. Upload uses **upload auto-pipeline** instead of requiring this button.

## Pipeline core

Deep Rust module (`src-tauri/src/pipeline/core.rs`) shared by upload auto-pipeline and Process: **persist lyrics → resolve language → translate**. Callers pass a language policy (`RespectManual` vs `ForceAutoDetect`) and choose `translate_one` (Edit) or `translate_batch` (upload). Source acquisition and event emission stay in the upload / Process adapters. Import’s early embedded write (`begin_upload`) stays outside this core.

## Library session

UI session hook (`useLibrarySession`): tracks list, lyrics cache, Home `openTrackId`, Edit `selectedEditTrackId`, refresh/upsert/load. Track-list search/sort/pane mode stays in Home/Edit (`useTrackListControls`), not here.

## Pipeline session

UI session hook (`usePipelineSession`): processing/phase/search/detecting state, `pipelineError`, upload/Process/search/language/preview commands, and Tauri pipeline/search/preview event subscriptions. Writes into the Library session on finish (upsert track, fill lyrics).

## Playback session

UI session hook (`usePlaybackSession`): playback status, scrub, volume, play/seek/next/prev. May patch `tracks.durationMs` on the Library session when the engine reports a duration (cross-session write used for duration match / UI).
