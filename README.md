# Melodica

Downloadable desktop music player that helps you learn a language through music you already like. Import a local audio file, play it, and follow original lyrics with per-word English glosses and a full-sentence English sense beside each line.

DISCLAIMER: This will simply help with vocabulary, structure and complete meanings. Learning a language is difficult and many subtlties could and would be lost in translations. This program was designed to enjoy music while also properly learning a language.

Product intent and constraints: [`PRODUCT.md`](./PRODUCT.md). Architecture notes: [`plan.md`](./plan.md). Pipeline flowchart: [`flow.md`](./flow.md).

## Layout

| Path | Role |
|------|------|
| `src/` | React + TypeScript UI (Tauri webview) |
| `src-tauri/` | Rust core — playback, tags, SQLite, LRCLIB, IPC |
| `sidecar/` | Python FastAPI language service (Whisper ASR, translate-align) |
| `docs/` | Glossary and ADRs |

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

**Option A — Settings (recommended):** In Melodica, open **Settings → Translation API key**, paste the Gemini key, and click **Save key**. A Settings key **overrides** the environment variable.

**Option B — Environment variable** (used when no Settings key is stored):

```bash
export MELODICA_TRANSLATE_API_KEY="AIza..."
# optional overrides:
export MELODICA_TRANSLATE_BASE_URL="https://generativelanguage.googleapis.com/v1beta"
export MELODICA_TRANSLATE_MODEL="gemini-3.1-flash-lite"
```

Start `tauri:dev` / the sidecar in shells that inherit these variables if you rely on Option B.

## Run the desktop app

```bash
npm install
npm run tauri:dev
```

For transcription and translation, also start the sidecar in another terminal:

```bash
npm run sidecar:install
npm run sidecar:dev
```

First sidecar start downloads the Whisper `base` model. **Upload** auto-runs lyrics + translation for each chosen file (LRCLIB within ±1s of duration, else tags, else `POST /transcribe`), then batches same-language tracks into `POST /translate-align`. On **Edit**, selecting an LRCLIB match runs select-time `POST /detect-language` (no lyrics persist). After Process saves originals, it re-detects when language is not manual, then calls `POST /translate-align` for that track when the song is not already English (requires API key + network). LRCLIB lookup and pasted lyrics run from the Rust core; translation still needs the sidecar.

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

### Planned (source of truth: [`PRODUCT.md`](./PRODUCT.md))

- Additional translation target languages beyond English
- Offline / local LLM behind the same provider interface
- Volume control, playlists, liked tracks
- Bundle the sidecar as a Tauri `externalBin` (see [Distribution](#distribution-end-user-packaging)) so end users never install Python
- Stronger audio/lyrics pipeline (confidence scoring, smarter LRCLIB pick on upload, multi-song translate batching, phonetics)
- Accessibility standard TBD
