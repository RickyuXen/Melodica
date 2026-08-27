# Melodica — how the parts fit together

Melodica is one downloadable desktop app made of three cooperating layers. Tauri is the glue: it owns the native window, embeds the React UI, and hosts the Rust core that does the real work.

```
┌─────────────────────────────────────────────┐
│  Melodica window (Tauri)                    │
│                                             │
│   React + TypeScript  ──invoke()──►  Rust   │
│   (what you see)                    (core)  │
│                                       │     │
│                                       ▼     │
│                              Python sidecar │
│                              (localhost)    │
└─────────────────────────────────────────────┘
```

Today the full loop is live: library upload (multi-file auto-pipeline), playback, LRCLIB, SQLite cache, Edit Process, and the Python sidecar for ASR / detect / translate-align.

---

## Tauri: the application shell

**Tauri** is not a UI framework and not a music engine. It is the packaging and runtime that turns Melodica into a real installable app (`.msi` / `.dmg` / `.AppImage`).

It does three jobs:

1. **Opens a native OS window** with a webview inside it (like a tiny browser that only loads your app).
2. **Loads the React frontend** into that webview (`src/` built by Vite).
3. **Runs the Rust backend** (`src-tauri/`) in the same process and exposes Rust functions to the UI over IPC.

So when you run `npm run tauri:dev`, Tauri starts Vite for the UI, compiles/runs Rust, and shows one Melodica window. Without Tauri, React would only be a website in a normal browser — with no reliable access to local files, audio backends, or a bundled native core.

Config lives in `src-tauri/tauri.conf.json` (window title/size, how to start/build the frontend). Permissions for what the webview may call are in `src-tauri/capabilities/`.

---

## React + TypeScript: the UI layer (`src/`)

React draws Home / Upload / Edit / Settings: library, player controls, lyrics panels, and status for the upload auto-pipeline.

It does **not** decode audio, talk to SQLite, or call LRCLIB directly. Those belong in Rust (and the sidecar). The UI asks Rust to do things and renders the results.

### How React talks to Rust

Tauri provides `invoke()` from `@tauri-apps/api`. The UI calls a named Rust command and awaits a JSON-friendly response.

```
App.tsx  →  getAppInfo() in src/lib/tauri.ts  →  invoke("app_info")  →  Rust fn app_info()
```

That is the pattern for every feature:

| User action (UI)        | Rust command (example) | Rust responsibility                          |
| ----------------------- | ---------------------- | -------------------------------------------- |
| Play / pause            | `playback_toggle`      | Drive the audio backend                      |
| Choose music files      | `process_uploads`      | Upsert tracks + upload auto-pipeline         |
| Process lyrics (Edit)   | `process_lyrics`       | Save lyrics + per-track translate            |
| View lyrics             | `get_lyrics`           | Load `lyrics_cache`                          |

React stays thin: state, layout, and calling into Rust.

---

## Rust: the core (`src-tauri/`)

Rust is Melodica’s **native brain**. It sits between the webview and the machine (disk, speakers, local DB, sidecar HTTP).

### What Rust owns (by design)

- **IPC bridge** — commands the UI can call (`#[tauri::command]` in `lib.rs`).
- **Playback** — decode + output (`playback.rs`; symphonia + rodio).
- **Tags & library files** — read metadata from audio files.
- **Storage** — SQLite for tracks, lyrics cache, playlists (`storage.rs`).
- **LRCLIB** — search/fetch and duration-matched auto-select (`lrclib.rs` / `pipeline.rs`).
- **Sidecar client** — HTTP to the Python service on localhost (`sidecar.rs`).
- **Upload auto-pipeline** — acquire lyrics (parallel LRCLIB, serial Whisper), batch translate by language.

### Why Rust sits in the middle

The UI should not open random localhost ports or manage long-running NLP itself. Rust:

- validates paths and requests,
- keeps playback timing authoritative,
- caches pipeline results in SQLite,
- only calls Python when language work is needed.

So the “pipelining” for a song (import → lyrics → detect language → translate → cache) is **orchestrated in Rust**. Python implements the language steps; Rust decides _when_ to run them and _what_ to store.

### Current wiring

`lib.rs` registers playback, library, lyrics, upload, and settings commands and starts the Tauri builder. `pipeline.rs` orchestrates upload auto-pipeline and Edit Process.

---

## Python sidecar: language intelligence (`sidecar/`)

The sidecar is a **small FastAPI server bound to `127.0.0.1`**. It is not the UI and not the player. It exists because Python’s NLP/ASR ecosystem (fastText, Whisper, LLM clients) is stronger for Melodica’s lyrics pipeline.

### Responsibilities

- Language detection on lyrics text
- Translation + line alignment (`/translate-align`, multi-document)
- Transcription fallback when no lyrics exist (`/transcribe`)

LRCLIB search/fetch lives in Rust, not the sidecar.

### How it connects

```
UI  →  Rust command  →  Rust HTTP client  →  http://127.0.0.1:8765/...  →  FastAPI
```

React never talks to Python. Rust does, then returns structured data (original lines, word glosses, sentence sense, timestamps, language code) for the UI to render.

The sidecar exposes `/health`, `/transcribe`, `/detect-language`, and `/translate-align`. Developers run it with `npm run sidecar:dev`. Later, Tauri can spawn the sidecar as a bundled binary so users never install Python themselves. Target packaging path: freeze the FastAPI service (e.g. PyInstaller) → register as Tauri `externalBin` → spawn/kill with the app lifecycle → ship via `tauri build` (installer or portable folder). End users should never need Node, Rust, or a manual `npm run sidecar:dev`. Details: [`PRODUCT.md`](./PRODUCT.md) (distribution intent) and [`README.md`](./README.md#distribution-end-user-packaging).

---

## End-to-end flow

1. **User imports one or more files** in the React UI.
2. **Rust** upserts tracks, runs upload auto-pipeline (duration-matched LRCLIB → tags → Whisper), detects language, then batch-translates by language via the sidecar.
3. **Rust** stores aligned lines in `lyrics_cache`.
4. **React** shows per-track phase status, then Home View lyrics (glosses + sense) synced to playback.

Edit remains for paste, language override, and manual Process. Optional internet use happens for LRCLIB, Gemini translation, and (when needed) Whisper model download. Playback and the library stay local.

---

## Folder map (mental model)

| Folder       | Runtime role                                       |
| ------------ | -------------------------------------------------- |
| `src/`       | React UI inside Tauri’s webview                    |
| `src-tauri/` | Rust core + Tauri config + app binary              |
| `sidecar/`   | Python FastAPI language service (separate process) |
| `plan.md`    | Full architecture and build order                  |

---

## What “connected” means

| Link              | Today                                                         | Still planned                         |
| ----------------- | ------------------------------------------------------------- | ------------------------------------- |
| React ↔ Rust      | Playback, library, upload auto-pipeline, Edit Process, settings | —                                     |
| Rust ↔ Python     | Localhost HTTP for transcribe / detect / translate-align      | Bundle sidecar as `externalBin`       |
| Tauri ↔ installer | `tauri build` packaging                                       | Ship sidecar with the app             |

Tauri + React give you the downloadable window and UI. Rust owns core logic and orchestration. Python handles language understanding when Rust asks for it.
