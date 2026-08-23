# Melodica glossary

## Active line

The lyric line treated as “currently being sung” for karaoke highlight: the last line whose `timestampMs` is less than or equal to playback `positionMs`. Null-timestamp lines are ignored. Before the first timed line, there is no active line.

## Synced lyrics

A lyric set where at least one line has a non-null `timestampMs`. Only synced sets support karaoke highlight and seek-to-line.

## timestampMs

Optional start time of a lyric line in milliseconds from the beginning of the track. Stored on `lyrics_cache` / `LyricLine`. There is no end timestamp; a line stays active until the next timed line starts.

## Seek-to-line

User action (click or keyboard activate on a timed line button) that seeks playback to that line’s `timestampMs`, using the same path as the scrubber (`onSeekCommit` → play if needed → `playbackSeek`).

## View lyrics

Home Library control that expands a track’s lyric panel (`LyricsDisplay`). This is the only surface with karaoke highlight and seek-to-line.
