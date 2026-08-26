# Current pipeline

What Melodica does today, from file to lyrics on screen (including translation after Process).

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
  saveOrig[Save originals to lyrics_cache]
  detect[Detect language from the lyrics text]
  skip{primaryTag equals target en?}
  translate[Sidecar translate-align]
  saveTx[Write sense + word_glosses]
  softFail[Keep originals; soft-fail]
  show[Home View lyrics]

  upload --> meta --> embedded
  embedded -->|yes| showTags --> play
  embedded -->|no| play
  play --> panel --> search --> pick --> process --> source
  source -->|pasted text| user
  source -->|selected match| lrclib
  source -->|neither, tags exist| tags
  source -->|neither, no tags| whisper
  user --> saveOrig
  lrclib --> saveOrig
  tags --> saveOrig
  whisper --> saveOrig
  saveOrig --> detect --> skip
  skip -->|yes| show
  skip -->|no or unknown| translate
  translate -->|ok| saveTx --> show
  translate -->|error| softFail --> show
```

Process order: **paste > LRCLIB match > embedded tags > Whisper**.

## Line-aligned translation (as of Process)

After originals are stored and language is detected:

- **Skip** when the primary language tag equals the target (`en` for now).
- Otherwise call the sidecar `POST /translate-align` with **one lyrics document containing all lines** (the API accepts **multiple same-language documents** for future multi-song upload batching).
- Each line stores:
  - `translated_text` — full sentence sense in the target language
  - `word_glosses` — JSON `[{text, gloss}, …]` under the original tokens
- Home **View lyrics** shows tokens with glosses underneath and the sentence sense in a separated column to the right.
- Translation failures **soft-fail**: Process still succeeds with originals; Home shows a muted hint to try again / check the API key.

API key precedence: **Settings-stored key overrides `MELODICA_TRANSLATE_API_KEY`**.

# Future flow

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

## Multi-song translate batching

`POST /translate-align` already accepts multiple `documents` of the same source language. When upload can process many songs at once, Rust should group tracks by language and pass several documents per call to save provider round-trips.
