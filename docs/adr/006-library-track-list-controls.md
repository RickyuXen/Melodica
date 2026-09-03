# ADR 006: Library track list controls

## Status

Accepted (2026-08-31)

## Context

The Home and Edit split panes showed a compact three-column track list (title, artist, language) ordered by upload time (`added_at DESC` from the backend). Users needed to find songs quickly in larger libraries, sort by metadata columns, and temporarily maximize either the song list or the lyrics/editor pane without leaving the tab.

## Decision

1. **Frontend display sort** — Default sort is title ascending (case-insensitive). Column headers (Title, Artist, Language) are clickable and toggle ascending/descending. Backend `list_tracks` order is unchanged so playback next/prev still follows library add order.

2. **Search** — A search field above the grid filters tracks by title, artist, or human-readable language name. Empty filter results show “No matching songs.”

3. **Pane modes** — Three session-scoped modes on both Home and Edit:
   - `split` (default): 25% / 75% grid
   - `list-only`: full-width song list; lyrics/editor hidden
   - `lyrics-only`: lyrics/editor full width; song list hidden
   Toolbar icon buttons expand, contract, and restore split.

4. **Shared implementation** — `trackList.ts` utilities, `useTrackListControls` hook, `TrackListToolbar`, sortable `TrackListHeader`, and shared `TrackList` for Home and Edit.

5. **App icons** — Tauri dock/taskbar icons regenerated from a square crop of the Melodica logo mark (`icon-master.png` → `tauri icon`).

## Consequences

- Home and Edit each maintain independent search/sort/pane state (not synced across tabs).
- Pane mode resets to split on every app launch (not persisted).
- Sticky toolbar + header keep search and sort accessible while scrolling long libraries.
- `EditView.tsx` extracts Edit tab layout; `HomeView.tsx` owns Home layout wiring.
