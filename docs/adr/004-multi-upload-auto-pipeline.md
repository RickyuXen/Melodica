# ADR 004: Multi-upload auto-pipeline and duration-matched LRCLIB

## Status

Accepted

## Context

Users importing a library one file at a time, then opening Edit → Process for each track, made Melodica’s study loop feel manual. PRODUCT already called for multi-file upload, closest-duration LRCLIB selection, and batched `translate-align`. Edit auto-selected the first LRCLIB hit regardless of duration. The sidecar already accepted multiple documents; Rust always sent one.

## Decision

- **Every upload** (one path or many) upserts tracks then runs an **upload auto-pipeline** in the background.
- **LRCLIB auto-select** uses **duration match (±1s)** of track length vs match `durationSeconds`; closest wins; API order breaks ties; missing duration ⇒ no auto pick. Edit search emits `preferredMatchId` from the same helper.
- **Acquisition order** when no duration match: embedded tags → Whisper (serial). Duration-matched LRCLIB wins over tags.
- **Language:** upload always auto-detects (clears prior manual override for that track). Edit Process still respects `language_manual`.
- **Translation:** wait until the upload set finishes acquisition; group by primary language tag; one `translate-align` per non-`en` group (including unknown). Soft-fail translation and per-track acquisition failures; continue the rest.
- **Concurrency:** parallel LRCLIB search/fetch across tracks; Whisper one at a time.
- **Re-upload** of an existing `file_path` upserts metadata and re-runs the pipeline.
- **UX:** emit `pipeline-phase` (`importing` | `searching` | `transcribing` | `translating` | `ready` | `failed`) and show per-track status in the library.

## Consequences

- Upload no longer stops at metadata (+ optional embedded lyrics); Home can show study lyrics after upload without Edit.
- Edit remains for paste, override, and surgical Process; duration rule is shared so auto-select does not drift.
- Batching reduces Gemini round-trips for multi-file imports of the same language.
- Whisper still serializes on the sidecar; large multi-uploads can take a long time (status labels make that visible).
- Confidence scoring beyond the ±1s gate remains out of scope (see PRODUCT planned).
