# Melodica

Downloadable desktop music player that surfaces dual-language, line-aligned lyrics. Architecture notes live in [`plan.md`](./plan.md).

## Layout

| Path | Role |
|------|------|
| `src/` | React + TypeScript UI (Tauri webview) |
| `src-tauri/` | Rust core — IPC bridge today; playback/storage later |
| `sidecar/` | Python FastAPI language service (stub; not wired yet) |

## Prerequisites

- Node.js 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the “Desktop development with C++” workload (`link.exe` must be on PATH)
- Python 3.10+ (only for the sidecar)

## Run the desktop app

```bash
npm install
npm run tauri:dev
```

This opens the Melodica window and exercises the UI ↔ Rust `app_info` command.

Build installers with:

```bash
npm run tauri:build
```

## Sidecar (optional, separate)

Not connected to the app yet — scaffold only.

```bash
npm run sidecar:install
npm run sidecar:dev
```

Health check: http://127.0.0.1:8765/health

## Current scope

Implemented: Tauri window, React shell, Rust `app_info` IPC, Python `/health` stub.

Next (per plan.md): folder import, play/pause/seek/volume, tag reading.
