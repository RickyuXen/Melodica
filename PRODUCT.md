# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are language learners at a desk, using their own music library to study while they listen. The first audience is the builder and people in the same situation — not classrooms, and not listeners who only want a generic player.

## Product Purpose

Melodica is a downloadable desktop music player that helps you learn a language through music you already like. You import a local audio file, play it, and follow the song’s original lyrics with a line-aligned English translation underneath.

Success: a learner can play a song they already like and follow original + English lines while it plays.

## Positioning

The product is not a streaming catalog or a conventional player with lyrics bolted on. Its mechanism is a local pipeline that turns a raw audio file the user already owns into original-language lyrics plus a line-aligned translation, cached so replays are instant. A neighboring player could ship playback; it could not truthfully claim this dual-language, file-owned study loop as its core.

## Operating Context

Used on a desktop, in a Tauri window (React UI in a webview, Rust core, optional Python sidecar on localhost). The library is the user’s own files (MP3, FLAC, WAV, OGG, M4A, AAC). Playback, tags, and SQLite live on the machine. Language work (transcription, detection, later translation) is orchestrated by Rust and may call the sidecar. Internet is optional, not required for the library or player.

**Distribution intent:** end users download an installable desktop app (Windows installer / equivalent on other platforms), then double-click Melodica. They never run `npm`, install Node/Rust, or start backend processes by hand. The React UI is baked into the Tauri binary at build time; Rust APIs run inside that process. The Python language sidecar is still started manually in development today; shipping it inside the app so it starts and stops with Melodica is planned (see below).

Typical loop: pick a file → play/seek → open the lyrics panel, search or paste, then Process.

## Capabilities and Constraints

**Must remain true**

- Local-first: library, playback, and the core lyrics pipeline run on the user’s machine; internet is optional.
- Users bring their own audio files. There is no streaming catalog.
- The signature job is original lyrics plus a line-aligned translation, not a generic music player.
- Translation target is English for now. Other target languages are later, not current product truth.
- End-user distribution is a downloadable desktop app (Tauri installer), not a website or a repo that requires `npm run` to use.

**Shipped today**

- Tauri desktop shell with Home / Upload / Edit / Settings tabs (`npm run tauri:dev` / `tauri:build`).
- Import a local file (MP3, FLAC, WAV, OGG, M4A, AAC), persist track metadata in SQLite, play / pause / seek.
- Lyrics from embedded tags, LRCLIB search/select (non-blocking), or user-pasted text. Whisper ASR runs only when the user Processes with no other source.
- Language detection from lyrics text.
- Karaoke-style line highlight synced to playback (Home “View lyrics”), with click-to-seek on timed lines.
- Light / dark theme and Melodica branding.
- Settings: database reset for local library wipe.

**Planned, not yet product facts**

- Line-aligned English translation (schema exists; generation is not shipped).
- Volume control, playlists, liked tracks.
- Bundle the Python sidecar so end users never install Python or run a second terminal:
  - Freeze the FastAPI service into a platform binary (e.g. PyInstaller).
  - Register it as a Tauri `externalBin` and spawn/kill it with the app lifecycle.
  - Ship via `tauri:build` (NSIS/MSI on Windows, plus macOS/Linux bundles). Prefer one download → install or unzip → double-click over a literally single self-contained `.exe` that embeds Whisper weights.
  - Whisper model may still download into app data on first ASR use (weights are large).
- Stronger audio/lyrics pipeline:
  - Confidence scoring over LRCLIB + translation results (prefer ~90%+ matches).
  - On upload, auto-select the LRCLIB option closest in duration, then fall back toward translation.
  - For non-English songs: high-quality translations under each line (per-word plus full line meaning).
  - English-equivalent phonetic transcription.

**Open**

- Whether later translation stays fully offline (local LLM) or may use a cloud provider behind a swappable interface.
- Accessibility standard: none specified yet.

## Brand Commitments

- Name: Melodica.
- Voice in product copy is plain and instructional (“Learn languages through the music you already like.”).
- Binding palette constraint from the owner: purple, orange, white, and hues of those colors.

## Evidence on Hand

- Architecture and intent: `plan.md`, `explanation.md`, `README.md`.
- Working prototype: library upload, playback, lyrics panel, language detection, karaoke line sync, sidecar ASR.
- App icons under `src-tauri/icons/`.
- No testimonials, customers, benchmarks, pricing, or press. Future work must not invent them. Demonstration tracks are the user’s own files, not a fake catalog.

## Product Principles

1. Study happens inside playback, not in a separate flashcard app.
2. Own files, own machine: the library never depends on a streaming service.
3. Dual-language, line-aligned lyrics are the product; player chrome exists to serve that job.
4. English is the current translation target; do not pretend multilingual targets exist until they ship.
5. Do not fabricate social proof, catalogs, or capabilities that are still on the roadmap.
