# ADR 005: Music player shell layout

## Status

Accepted (2026-08-31)

## Context

Melodica shipped as a narrow centered column with a horizontal tab bar. Users expected a standard desktop music player: persistent playback controls, a library browse surface, and clear separation between listening (Home) and editing lyrics (Edit).

## Decision

Adopt a full-viewport shell:

1. **Sidebar (20%)** — brand + vertical nav with icons; connection status in footer.
2. **Main column (80%)** — scrollable tab content above a fixed **now playing bar**.
3. **Home** — split pane: library list left, lyrics right; row click auto-plays.
4. **Edit** — split pane: editor left (75%), track picker right (25%); distinct panel chrome.

Icons via `lucide-react`. No backend changes.

## Consequences

- Playback controls are global, not per-track rows.
- `Header.tsx` removed; `AppTab` lives on `Sidebar`.
- `TrackItem` is edit-only; library rows use `LibraryTrackList`.
- Lyrics list height unconstrained in Home split (fills available pane).
- Mobile: optional icon-only sidebar collapse at 768px.
