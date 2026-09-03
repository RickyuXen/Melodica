# Melodica domain context

Domain vocabulary lives in [`glossary.md`](glossary.md). Architecture decisions live in [`adr/`](adr/).

## Runtime seams

- **UI ↔ Rust** — Tauri `invoke` + events (`pipeline-*`, `lyrics-search-*`, `language-preview-*`).
- **Rust ↔ Python sidecar** — localhost HTTP (transcribe, detect-language, translate-align).

Rust owns orchestration and SQLite. The sidecar owns ASR, language ID, and LLM translation.

## Deepened modules (architecture)

| Module | Where | Role |
| --- | --- | --- |
| **Pipeline core** | `src-tauri/src/pipeline/core.rs` | Persist → language → translate (one or batch) |
| Upload adapter | `src-tauri/src/pipeline/upload.rs` | Upload auto-pipeline policy + phases |
| Process adapter | `src-tauri/src/pipeline/process.rs` | Edit Process policy |
| Select-time / search | `src-tauri/src/pipeline/preview.rs` | Detect without lyrics_cache; LRCLIB search |
| **Library session** | `src/hooks/useLibrarySession.ts` | Tracks + lyrics cache + selection |
| **Pipeline session** | `src/hooks/usePipelineSession.ts` | Pipeline UI state + events |
| **Playback session** | `src/hooks/usePlaybackSession.ts` | Player + scrub; may patch track duration |

`App.tsx` is the composition root that wires the three UI sessions.
