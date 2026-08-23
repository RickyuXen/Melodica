# ADR 001: Lyrics sync highlight and seek-to-line

## Status

Accepted

## Context

Melodica already stores optional per-line `timestampMs` (LRC / LRCLIB / ASR) and exposes `positionMs` plus `playbackSeek`. Home “View lyrics” only rendered plain text. Product goals call for karaoke-style line highlight and clicking a line to jump in the song.

## Decision

- Implement sync **only** in Home Library `View lyrics` (`LyricsDisplay`). Edit remains an editing surface.
- **Active line** = last line with `timestampMs <= positionMs`. Nothing is active before the first timed line. Null-timestamp lines are never active or seekable.
- If **no** line is timed: no highlight, lines not seekable, show a muted hint pointing users to Edit for synced lyrics. Do **not** estimate seek times by index/duration.
- Seekable lines are `<button>` elements; click/keyboard calls existing `onSeekCommit` (play track if needed, then seek).
- Highlight only when the row’s track is **current** (`isCurrent`); paused current track still shows the active line.
- Auto-scroll the lyrics scroller to the active line; pause auto-scroll ~3s after user wheel/touch on the list.
- Visual: active line stronger weight/color; other lines slightly muted while syncing on the current track.

## Consequences

- No Rust, SQLite, or pipeline changes for this feature.
- Word-level karaoke and end timestamps remain out of scope (data is start-only).
- Unsynced pastes stay readable but non-interactive for seek/highlight until the user fetches synced lyrics.
