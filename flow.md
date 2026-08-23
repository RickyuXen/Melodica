# Current pipeline

What Melodica does today, from file to lyrics on screen.

```mermaid
flowchart TD
  upload[Upload local audio file]
  meta[Save title / artist / album / duration]
  embedded{File has lyric tags?}
  showTags[Store those lyrics]
  play[Play / pause / seek]
  panel[Open lyrics panel]
  search[Search LRCLIB]
  pick[Pick a match or paste lyrics]
  process[Process]
  source{What did the user give?}
  user[Use pasted text]
  lrclib[Fetch LRCLIB lyrics]
  tags[Use embedded tags]
  whisper[Whisper transcription]
  detect[Detect language from the lyrics text]
  show[Show original lines]

  upload --> meta --> embedded
  embedded -->|yes| showTags --> play
  embedded -->|no| play
  play --> panel --> search --> pick --> process --> source
  source -->|pasted text| user
  source -->|selected match| lrclib
  source -->|neither, tags exist| tags
  source -->|neither, no tags| whisper
  user --> detect
  lrclib --> detect
  tags --> detect
  whisper --> detect
  detect --> show
```

Process order: **paste > LRCLIB match > embedded tags > Whisper**.

# Future flow

Not built yet. Continues after original lyrics are stored.

## Line-aligned translation

Each original line (e.g. Japanese in `original_text`) is translated to English and saved on the **same** `lyrics_cache` row as `translated_text`. Mapping is `line_index`. Target is English for now; other languages later, still one `translated_text` per line.

```mermaid
flowchart TD
  lyrics[Original lyric lines stored]
  detect[Language already detected]
  each[Translate each line to English]
  save[Save English on that line as translated_text]
  show[Show original with English underneath]

  lyrics --> detect --> each --> save --> show
```

## Playlists

Tables `playlists` and `playlist_tracks` already exist. No UI yet.

```mermaid
flowchart TD
  create[Create playlist with a name]
  add[Add tracks in order]
  playList[Play the playlist]
  edit[Rename / remove tracks / delete playlist]

  create --> add --> playList
  add --> edit
```

## Play history

Table `play_history` already exists (`track_id`, `played_at`). When the user starts a track, append a history row. A recently-played list can read that table later.
