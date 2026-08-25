# Melodica

Downloadable desktop music player that helps you learn a language through music you already like. Import a local audio file, play it, and follow original lyrics with a line-aligned English translation underneath (translation generation is still on the roadmap).

Product intent and constraints: [`PRODUCT.md`](./PRODUCT.md). Architecture notes: [`plan.md`](./plan.md).

## Layout

| Path | Role |
|------|------|
| `src/` | React + TypeScript UI (Tauri webview) |
| `src-tauri/` | Rust core — playback, tags, SQLite, LRCLIB, IPC |
| `sidecar/` | Python FastAPI language service (Whisper ASR) |
| `docs/` | Glossary and ADRs |

## Prerequisites

- Node.js 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the “Desktop development with C++” workload (`link.exe` must be on PATH)
- Python 3.10+ (required for ASR when Process has no pasted lyrics, no LRCLIB match, and no embedded tags)

## Run the desktop app

```bash
npm install
npm run tauri:dev
```

For transcription fallback (Process with no pasted lyrics and no selected match), also start the sidecar in another terminal:

```bash
npm run sidecar:install
npm run sidecar:dev
```

First sidecar start downloads the Whisper `base` model. Process with no other lyrics source calls `POST /transcribe` and stores lines with `source=asr`. LRCLIB lookup and pasted lyrics run from the Rust core and do not need the sidecar.

Build installers with:

```bash
npm run tauri:build
```

Artifacts land under `src-tauri/target/release/bundle/` (e.g. Windows NSIS/MSI). End users should install or unzip and launch Melodica — they never need Node, Rust, or `npm`.

## Distribution (end-user packaging)

Today `tauri:build` packages the React UI into the Tauri binary and ships the Rust core (playback, SQLite, LRCLIB, IPC). The Python sidecar is still a separate process for developers.

Target for shipped builds (also in [`PRODUCT.md`](./PRODUCT.md)):

1. Freeze the FastAPI sidecar into a platform binary (e.g. PyInstaller / Nuitka) so no system Python is required.
2. Register it in `tauri.conf.json` as `bundle.externalBin` and place named binaries under `src-tauri/binaries/`.
3. On app start, Rust spawns the sidecar (localhost `8765`); on quit, it kills the process. Existing `sidecar.rs` HTTP calls then work without a second terminal.
4. Prefer one download → install or portable folder → double-click over a literally single `.exe` that embeds Whisper weights. The model may still download into app data on first ASR use.

Do not ship a launcher that runs `npm` or assumes Python on the user’s machine.

## Sidecar

Bound to `127.0.0.1:8765`.

- `GET /health`
- `POST /transcribe` — `{ "file_path": "..." }` → lyric segments

## Current scope

### Implemented

- Tauri desktop shell with Home / Upload / Edit / Settings tabs
- Library import for local audio (MP3, FLAC, WAV, OGG, M4A, AAC), SQLite persistence, play / pause / seek
- Lyrics from embedded tags (`lofty`), LRCLIB search/select (non-blocking), or user-pasted text
- Whisper ASR fallback via the Python sidecar when Process has no other lyrics source
- Language detection from lyrics text
- Karaoke-style line highlight synced to playback (Home “View lyrics”), with click-to-seek on timed lines
- Light / dark theme and Melodica branding
- Settings: database reset for local library wipe

### Planned (source of truth: [`PRODUCT.md`](./PRODUCT.md))

- Line-aligned English translation (schema exists; generation not shipped)
- Volume control, playlists, liked tracks
- Bundle the sidecar as a Tauri `externalBin` (see [Distribution](#distribution-end-user-packaging)) so end users never install Python
- Stronger audio/lyrics pipeline:
  - Confidence scoring over LRCLIB + translation results (prefer ~90%+ matches)
  - On upload, auto-select the LRCLIB option closest in duration, then fall back toward translation
  - For non-English songs: high-quality translations under each line (per-word plus full line meaning)
  - English-equivalent phonetic transcription
- Open: whether translation stays fully offline (local LLM) or may use a cloud provider behind a swappable interface; accessibility standard TBD
