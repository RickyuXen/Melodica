# Melodica glossary

## Active line

The lyric line treated as “currently being sung” for karaoke highlight: the last line whose `timestampMs` is less than or equal to playback `positionMs`. Null-timestamp lines are ignored. Before the first timed line, there is no active line.

## Synced lyrics

A lyric set where at least one line has a non-null `timestampMs`. Only synced sets support karaoke highlight and seek-to-line.

## timestampMs

Optional start time of a lyric line in milliseconds from the beginning of the track. Stored on `lyrics_cache` / `LyricLine`. There is no end timestamp; a line stays active until the next timed line starts.

## Seek-to-line

User action (click or keyboard activate on a timed line button) that seeks playback to that line’s `timestampMs`, using the same path as the scrubber (`onSeekCommit` → play if needed → `playbackSeek`).

## View lyrics

Home Library control that expands a track’s lyric panel (`LyricsDisplay`). This is the only surface with karaoke highlight, seek-to-line, and the dual study translation layout.

## Line sense

Full-sentence translation of one lyric line into the target language (English for now). Stored as `lyrics_cache.translated_text` / `LyricLine.translatedText`. Shown to the right of the word-gloss column on Home.

## Word gloss

Short target-language gloss for one token of the original line. Stored in `lyrics_cache.word_glosses` as JSON `[{ "text", "gloss" }, …]` and exposed as `LyricLine.wordGlosses`. Tokens are chosen by the translation model (not a separate tokenizer). Rendered directly under each original token.

## Primary language tag

The first subtag of a language code (`en-US` → `en`, `zh` → `zh`). Used to decide whether to skip translation when it equals the target (`en`).

## translate-align

Sidecar endpoint `POST /translate-align`. Accepts one or more lyrics **documents** of the same source language and returns per-line `sense` + `words` glosses. v1 Process sends one document with all lines; the multi-document shape is for future multi-song batching.

## Translation API key

Credential for the Google Gemini LLM provider (Flash by default). Precedence: Settings-stored key (SQLite `app_settings`) overrides environment `MELODICA_TRANSLATE_API_KEY`. Optional `MELODICA_TRANSLATE_BASE_URL` and `MELODICA_TRANSLATE_MODEL` configure the Generative Language API endpoint and model (default `gemini-3.1-flash-lite`).

## Select-time detection

On Edit, when the user selects an LRCLIB matching song (including the auto-selected first result), Melodica fetches that match’s lyrics and runs language detection **without** writing `lyrics_cache`. The result is stored on `tracks.language_code` with `language_manual=false` and shown in Song language. Soft-fails leave the code empty and show a hint. Manual overrides are sticky until Auto-detect. Lyrics persist and translation run only on **Process**.

## Process (lyrics pipeline)

Edit action that commits lyrics then translation: resolve source (paste > LRCLIB id > embedded tags > Whisper) → save originals to `lyrics_cache` → re-detect language when not manual → `translate-align` for non-English (soft-fail). Song language changes alone never Process.
