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

Typical loop: pick a file → play/seek → open the lyrics panel, search or paste, then Process.

## Capabilities and Constraints

**Must remain true**

- Local-first: library, playback, and the core lyrics pipeline run on the user’s machine; internet is optional.
- Users bring their own audio files. There is no streaming catalog.
- The signature job is original lyrics plus a line-aligned translation, not a generic music player.
- Translation target is English for now. Other target languages are later, not current product truth.

**Shipped today**

- Import a local file, persist track metadata, play / pause / seek.
- Lyrics from embedded tags, LRCLIB search/select, or user-pasted text. Whisper ASR runs only when the user Processes with no other source.
- Language detection from lyrics text.
- Desktop packaging via Tauri (`npm run tauri:dev` / `tauri:build`).

**Planned, not yet product facts**

- Line-aligned English translation (schema exists; generation is not shipped).
- Karaoke-style line highlight synced to playback.
- Volume control, playlists, liked tracks.
- Bundling the sidecar so end users never install Python.

**Open**

- Whether later translation stays fully offline (local LLM) or may use a cloud provider behind a swappable interface.
- Accessibility standard: none specified yet.

## Brand Commitments

- Name: Melodica.
- Voice in product copy is plain and instructional (“Learn languages through the music you already like.”).
- Binding palette constraint from the owner: purple, orange, white, and hues of those colors.

## Evidence on Hand

- Architecture and intent: `plan.md`, `explanation.md`, `README.md`.
- Working prototype: library upload, playback, lyrics panel, sidecar ASR.
- App icons under `src-tauri/icons/`.
- No testimonials, customers, benchmarks, pricing, or press. Future work must not invent them. Demonstration tracks are the user’s own files, not a fake catalog.

## Product Principles

1. Study happens inside playback, not in a separate flashcard app.
2. Own files, own machine: the library never depends on a streaming service.
3. Dual-language, line-aligned lyrics are the product; player chrome exists to serve that job.
4. English is the current translation target; do not pretend multilingual targets exist until they ship.
5. Do not fabricate social proof, catalogs, or capabilities that are still on the roadmap.
