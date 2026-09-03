# Melodica — UI design record

<!-- impeccable:design-schema 1 -->

## Shell layout

Desktop-first full-viewport grid:

| Region | Width | Component |
|--------|-------|-----------|
| Sidebar | 20% | [`Sidebar.tsx`](../src/components/Sidebar.tsx) |
| Main column | 80% | Tab content + [`NowPlayingBar.tsx`](../src/components/NowPlayingBar.tsx) |

CSS: `.app-shell { grid-template-columns: 20% 80%; height: 100vh }`

The main column is a flex column: `.main-content` (scrollable tab body) above `.now-playing-bar` (fixed footer).

## Sidebar navigation

Vertical nav with lucide-react icons: Home, Upload, Edit, Settings. Brand lockup (Melodica logo + name) at top; Rust core connection status in footer.

`AppTab` type exported from `Sidebar.tsx`.

## Now playing bar

Persistent footer in the main column (all tabs). Contains:

- Previous / play-pause / next
- Seek slider + elapsed/total
- Volume slider
- Clickable track title + artist → navigates to Home and opens that track’s lyrics

State wired from [`App.tsx`](../src/App.tsx) via existing Tauri playback commands.

## Home split view

25% / 75% grid inside the Home panel (overridable by pane mode):

| Column | Content |
|--------|---------|
| Left (25%) | [`TrackList.tsx`](../src/components/TrackList.tsx) with search, sortable columns, pane controls |
| Right (75%) | [`LyricsDisplay`](../src/components/LyricsDisplay.tsx) for `openTrackId` |

**Library pane modes** (session-scoped, toolbar in left pane):

| Mode | Layout |
|------|--------|
| `split` (default) | 25% library / 75% lyrics |
| `list-only` | Full-width library; lyrics hidden |
| `lyrics-only` | Full-width lyrics; library hidden |

Default track order: title ascending. Search filters title, artist, and language label.

## Edit split view

25% / 75% grid below Edit page header (same structure and pane modes as Home):

| Column | Content |
|--------|---------|
| Left (25%) | [`TrackList`](../src/components/TrackList.tsx) via [`EditView.tsx`](../src/components/EditView.tsx) |
| Right (75%) | [`LyricsEditor`](../src/components/LyricsEditor.tsx) |

Edit panel uses a stronger border (`border-color: var(--color-action)`) to distinguish from Home.

## Upload / Settings

Unchanged inner content; only wrapped by the new shell.

## Responsive (optional)

`@media (max-width: 768px)`: sidebar collapses to icon-only rail (~4rem); Home and Edit stacks vertically.

## Tokens

Uses existing [`theme.css`](../src/theme.css) semantic roles. No new color primitives added for this layout.
