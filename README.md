# Melodica

Downloadable desktop music player that surfaces dual-language, line-aligned lyrics. Architecture notes live in [`plan.md`](./plan.md).

## Layout

| Path | Role |
|------|------|
| `src/` | React + TypeScript UI (Tauri webview) |
| `src-tauri/` | Rust core — IPC bridge today; playback/storage later |
| `sidecar/` | Python FastAPI language service (Whisper ASR) |

## Prerequisites

- Node.js 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the “Desktop development with C++” workload (`link.exe` must be on PATH)
- Python 3.10+ (required for ASR when a file has no embedded lyrics)

## Run the desktop app

```bash
npm install
npm run tauri:dev
```

For transcription fallback (no embedded lyrics), also start the sidecar in another terminal:

```bash
npm run sidecar:install
npm run sidecar:dev
```

First sidecar start downloads the Whisper `base` model. Uploads without embedded lyrics call `POST /transcribe` and store lines with `source=asr`.

Build installers with:

```bash
npm run tauri:build
```

## Sidecar

Bound to `127.0.0.1:8765`.

- `GET /health`
- `POST /transcribe` — `{ "file_path": "..." }` → lyric segments

## Current scope

Implemented: Tauri window, library upload, SQLite tracks/lyrics, embedded lyrics via lofty, ASR fallback via faster-whisper.

Next (per plan.md): LRCLIB lookup, playback controls, translation.
