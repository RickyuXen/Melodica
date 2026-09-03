# Melodica

Downloadable desktop music player that helps you learn a language through music you already like. Import a local audio file, play it, and follow original lyrics with per-word English glosses and a full-sentence English sense beside each line.

DISCLAIMER: This will simply help with vocabulary, structure and complete meanings. Learning a language is difficult and many subtlties could and would be lost in translations. This program was designed to enjoy music while also properly learning a language.

Product intent and constraints: [`docs/PRODUCT.md`](./docs/PRODUCT.md). Architecture notes: [`docs/plan.md`](./docs/plan.md). Pipeline flowchart: [`docs/flow.md`](./docs/flow.md).

## Layout

| Path | Role |
|------|------|
| `src/` | React + TypeScript UI (Tauri webview) |
| `src-tauri/` | Rust core — playback, tags, SQLite, LRCLIB, IPC |
| `sidecar/` | Python FastAPI language service (Whisper ASR, translate-align) |
| `docs/` | Product docs, glossary, and ADRs |

## Prerequisites

- Node.js 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the “Desktop development with C++” workload (`link.exe` must be on PATH)
- Python 3.10+ (required for ASR and translation via the sidecar)
- A Google Gemini API key for lyric translation (see below)

## Translation API key

Process translates non-English lyrics through Google’s **Gemini Flash** API (`gemini-3.1-flash-lite` by default).

### How to get a Gemini API key

1. Open [Google AI Studio](https://aistudio.google.com/apikey) and sign in with a Google account.
2. Click **Create API key** (create or pick a Google Cloud project if prompted).
3. Copy the key once and store it somewhere safe.

### Configure the key

**Downloaded / release builds:** Open **Settings → Translation API key**, paste the Gemini key, and click **Save key**. Translation will not run without this.

**Development (`npm run tauri:dev`):** Either use Settings, or put the key in a project `.env` (see `.env.example`). The app loads `.env` automatically in debug builds. A Settings key overrides `.env`.

```bash
# .env (dev only — never shipped with the app)
MELODICA_TRANSLATE_API_KEY="AIza..."
# optional overrides:
MELODICA_TRANSLATE_BASE_URL="https://generativelanguage.googleapis.com/v1beta"
MELODICA_TRANSLATE_MODEL="gemini-3.1-flash-lite"
```

## Run the desktop app

```bash
npm install
npm run tauri:dev
```

`npm run tauri:dev` starts the language sidecar automatically. For a live-reloading Python process instead:

```bash
npm run sidecar:install
npm run sidecar:dev
```

First transcription downloads the Whisper `base` model. **Upload** auto-runs lyrics + translation for each chosen file (LRCLIB within ±1s of duration, else tags, else `POST /transcribe`), then batches same-language tracks into `POST /translate-align`. On **Edit**, selecting an LRCLIB match runs select-time `POST /detect-language` (no lyrics persist). After Process saves originals, it re-detects when language is not manual, then calls `POST /translate-align` for that track when the song is not already English (requires API key + network). LRCLIB lookup and pasted lyrics run from the Rust core; translation and ASR use the sidecar.

Build a standalone desktop app (UI + Rust core + frozen Python sidecar) with:

```bash
npm run dist
```

That command rebuilds the sidecar when its sources change, then packages Melodica. Artifacts land under `release/` (replaced in place on each run) and `src-tauri/target/release/bundle/`.

- **macOS:** `release/Melodica.app` — double-click to run. The language sidecar starts and stops with the app.
- **Windows:** `release/Melodica.exe` plus the sidecar next to it (or the NSIS installer under `bundle/nsis/`). Produce `.exe` by running `npm run dist` on Windows.

End users never need Node, Rust, or Python. The Whisper `base` model still downloads into app cache on first transcription.

For day-to-day development, `npm run tauri:dev` still works. You can keep using `npm run sidecar:dev` if you prefer a live-reloading Python process; otherwise the app starts a bundled/dev sidecar on port 8765.

## Sidecar

Bound to `127.0.0.1:8765`.

- `GET /health`
- `POST /transcribe` — `{ "file_path": "..." }` → lyric segments
- `POST /detect-language` — lyrics text → language code
- `POST /translate-align` — multi-document lyrics → per-line `sense` + `words` glosses (Gemini Flash)

## Current scope

### Implemented

- Tauri desktop shell with Home / Upload / Edit / Settings tabs
- Library import for local audio (MP3, FLAC, WAV, OGG, M4A, AAC), SQLite persistence, play / pause / seek
- Lyrics from embedded tags (`lofty`), LRCLIB search/select (non-blocking), or user-pasted text
- Whisper ASR fallback via the Python sidecar when Process has no other lyrics source
- Select-time language detection on LRCLIB match select; Song language override is preference-only until Process
- Process-time English translation: word glosses + sentence sense (skip when source is English; soft-fail on errors)
- Home “View lyrics”: karaoke sync/seek and dual study layout
- Settings: theme, translation language preference, translation API key, database reset
- Light / dark theme and Melodica branding
- Standalone desktop build (`npm run dist`) that packages the UI, Rust core, and language sidecar

### Planned (source of truth: [`docs/PRODUCT.md`](./docs/PRODUCT.md))

- Additional translation target languages beyond English
- Offline / local LLM behind the same provider interface
- Volume control, playlists, liked tracks
- Stronger audio/lyrics pipeline (confidence scoring, smarter LRCLIB pick on upload, multi-song translate batching, phonetics)
- Accessibility standard TBD
