# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are language learners at a desk, using their own music library to study while they listen. The first audience is the builder and people in the same situation — not classrooms, and not listeners who only want a generic player.

## Product Purpose

Melodica is a downloadable desktop music player that helps you learn a language through music you already like. You import a local audio file, play it, and follow the song’s original lyrics with per-word English glosses under each token and a full-sentence English sense beside the line.

Success: a learner can play a song they already like and follow original + English study layout while it plays.

## Positioning

The product is not a streaming catalog or a conventional player with lyrics bolted on. Its mechanism is a local pipeline that turns a raw audio file the user already owns into original-language lyrics plus a line-aligned translation (word glosses + sentence sense), cached so replays are instant. A neighboring player could ship playback; it could not truthfully claim this dual-language, file-owned study loop as its core.

## Operating Context

Used on a desktop, in a Tauri window (React UI in a webview, Rust core, optional Python sidecar on localhost). The library is the user’s own files (MP3, FLAC, WAV, OGG, M4A, AAC). Playback, tags, and SQLite live on the machine. Language work (transcription, detection, translation) is orchestrated by Rust and may call the sidecar. Library and playback work offline; translation uses Google Gemini Flash today (swappable provider interface for a later offline option).

**Distribution intent:** end users download an installable desktop app (Windows installer / equivalent on other platforms), then double-click Melodica. They never run `npm`, install Node/Rust, or start backend processes by hand. The React UI is baked into the Tauri binary at build time; Rust APIs run inside that process. The Python language sidecar is still started manually in development today; shipping it inside the app so it starts and stops with Melodica is planned (see below).

Typical loop: pick one or more files → upload auto-pipeline finds lyrics and translates → play/seek on Home. Edit remains for search, paste, language override, and manual Process.

## Capabilities and Constraints

**Must remain true**

- Local-first: library, playback, and the core lyrics pipeline run on the user’s machine; internet is optional for those, but translation currently needs a network LLM unless skipped.
- Users bring their own audio files. There is no streaming catalog.
- The signature job is original lyrics plus line-aligned study translation (word glosses + sentence sense), not a generic music player.
- Translation target is English for now. Code is parameterized so other targets can be added later; Settings may show extra language prefs before generation wires them up.
- End-user distribution is a downloadable desktop app (Tauri installer), not a website or a repo that requires `npm run` to use.

**Shipped today**

- Tauri desktop shell with Home / Upload / Edit / Settings tabs (`npm run tauri:dev` / `tauri:build`).
- Import one or more local files (MP3, FLAC, WAV, OGG, M4A, AAC), persist track metadata in SQLite, play / pause / seek / volume.
- **Upload auto-pipeline:** every upload (single or multi) runs lyrics acquisition then translation without requiring Edit → Process. Library shows per-track phase (importing / finding lyrics / transcribing / translating).
- Lyrics source on upload: LRCLIB match within ±1s of track duration (closest wins; API order on ties) → else embedded tags → else Whisper ASR. Missing durations do not auto-pick LRCLIB. Soft-fail per track; the rest of the set continues.
- Multi-upload translation: after all tracks in the set finish acquisition, group by primary language tag and call `translate-align` once per non-English group (unknown/`null` language still attempts translation). English source language skips translation.
- Edit: LRCLIB search/select (non-blocking) uses the same ±1s preferred match for auto-select; paste and manual Process still work (paste > LRCLIB id > tags > Whisper, then per-track translate).
- Select-time language detection when an LRCLIB match is chosen (including duration-matched auto-select); Song language shows auto-detected code and allows override without Processing. Paste waits for Process-time detect. Upload auto-pipeline always auto-detects (clears prior manual override for that track).
- After lyrics are saved: for non-English (or unknown) lyrics, sidecar translation writes per-line English sense (`translated_text`) and word glosses (`word_glosses`).
- Home “View lyrics”: karaoke-style line highlight and seek, plus dual study layout (glosses under tokens, sense to the right). Soft-fail leaves originals if translation fails.
- Translation API key: Settings (overrides env) or `MELODICA_TRANSLATE_API_KEY`.
- Light / dark theme and Melodica branding.
- Settings: theme, translation language preference (generation is English-only for now), API key, database reset (preserves API key).

**Planned, not yet product facts**

- Additional translation target languages beyond English (Settings preference already lists French).
- Offline / local LLM provider behind the same translate interface.
- Playlists, liked tracks.
- Bundle the Python sidecar so end users never install Python or run a second terminal:
  - Freeze the FastAPI service into a platform binary (e.g. PyInstaller).
  - Register it as a Tauri `externalBin` and spawn/kill it with the app lifecycle.
  - Ship via `tauri:build` (NSIS/MSI on Windows, plus macOS/Linux bundles). Prefer one download → install or unzip → double-click over a literally single self-contained `.exe` that embeds Whisper weights.
  - Whisper model may still download into app data on first ASR use (weights are large).
- Stronger audio/lyrics pipeline:
  - Confidence scoring over LRCLIB + translation results (prefer ~90%+ matches).
  - English-equivalent phonetic transcription.
- add logging


**Open**

- Accessibility standard: none specified yet.

## Brand Commitments

- Name: Melodica.
- Voice in product copy is plain and instructional (“Learn languages through the music you already like.”).
- Binding palette constraint from the owner: purple, orange, white, and hues of those colors.

## Evidence on Hand

- Architecture and intent: `docs/plan.md`, `docs/explanation.md`, `README.md`, `docs/flow.md`.
- Working prototype: multi-file upload auto-pipeline, playback, lyrics panel, language detection, karaoke line sync, sidecar ASR, batched translate-align with word glosses + line sense.
- App icons under `src-tauri/icons/`.
- No testimonials, customers, benchmarks, pricing, or press. Future work must not invent them. Demonstration tracks are the user’s own files, not a fake catalog.

## Product Principles

1. Study happens inside playback, not in a separate flashcard app.
2. Own files, own machine: the library never depends on a streaming service.
3. Dual-language, line-aligned lyrics are the product; player chrome exists to serve that job.
4. English is the current translation target; do not pretend multilingual targets exist until they ship.
5. Do not fabricate social proof, catalogs, or capabilities that are still on the roadmap.
