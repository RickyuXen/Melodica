# Current pipeline

What Melodica does today, from file to lyrics on screen (upload auto-pipeline, Edit Process, select-time language detect, and translation).

## Upload auto-pipeline

Every upload (one file or many) upserts tracks then runs lyrics + translation in the background.

```mermaid
flowchart TD
  pick[Multi-select audio files]
  upsert[Upsert each track metadata]
  statusImport[Status: importing]
  parallelLrc[Parallel LRCLIB search per track]
  pickMatch{"Any match with abs duration delta lte 1s?"}
  useLrc[Fetch closest LRCLIB lyrics]
  useTags{Embedded tags?}
  useWhisper[Whisper serial queue]
  saveOrig[Save originals + auto-detect language]
  waitAll[Wait for all tracks in upload set]
  groupLang[Group by primary language tag]
  skipEn[Skip en groups]
  batchTx[One translate-align per non-en group]
  ready[Status: ready / failed hint]

  pick --> upsert --> statusImport --> parallelLrc --> pickMatch
  pickMatch -->|yes| useLrc --> saveOrig
  pickMatch -->|no| useTags
  useTags -->|yes| saveOrig
  useTags -->|no| useWhisper --> saveOrig
  saveOrig --> waitAll --> groupLang --> skipEn --> batchTx --> ready
```

Duration compare: track `duration_ms` vs LRCLIB `durationSeconds`. Missing either side → no LRCLIB auto-pick. Ties: closest delta, then LRCLIB API order. Soft-fail per track; batch-translate whoever acquired successfully. Unknown language still attempts translation with `sourceLanguage: null`.

## Edit Process (manual)

```mermaid
flowchart TD
  panel[Open Edit lyrics panel]
  search[Search LRCLIB]
  pick[Pick a match or paste lyrics]
  selectDetect[Select-time: fetch match text + detect language]
  showLang[Show auto-detected language / allow override]
  process[Process]
  source{What did the user give?}
  user[Use pasted text]
  lrclib[Fetch LRCLIB lyrics]
  tags[Use embedded tags]
  whisper[Whisper transcription]
  saveOrig[Save originals to lyrics_cache]
  detect[Re-detect language if not manual]
  skip{primaryTag equals target en?}
  translate[Sidecar translate-align one document]
  saveTx[Write sense + word_glosses]
  softFail[Keep originals; soft-fail]
  show[Home View lyrics]

  panel --> search --> pick
  pick -->|LRCLIB match selected| selectDetect --> showLang
  pick -->|paste or None| showLang
  showLang --> process --> source
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

Edit LRCLIB auto-select uses the same **±1s duration match** as upload (`preferredMatchId` on search results). Select-time detect runs on LRCLIB match select only (not paste). It does **not** write lyrics. Song language override is preference-only until Process.

## Line-aligned translation

After originals are stored and language is resolved:

- **Skip** when the primary language tag equals the target (`en` for now).
- **Upload set:** one `POST /translate-align` per language group with **multiple documents**.
- **Edit Process:** one document containing all lines for that track.
- Each line stores:
  - `translated_text` — full sentence sense in the target language
  - `word_glosses` — JSON `[{text, gloss}, …]` under the original tokens
- Home **View lyrics** shows tokens with glosses underneath and the sentence sense in a separated column to the right.
- Translation failures **soft-fail**: originals remain; Home shows a muted hint to try again / check the API key.

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
