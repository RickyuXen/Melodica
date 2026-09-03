"""Melodica language sidecar — FastAPI.

Bound to localhost only. Provides ASR transcription, language detection,
and multi-document lyric translation with word glosses.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .language import (
    detect_lyrics_language,
    metadata_blob,
    script_language,
    whisper_language_code,
)
from .translate import (
    TranslateAlignRequest,
    translate_align,
)

_model = None
_CLIP_SECONDS = 30
_SAMPLE_RATE = 16000


def _get_model():
    """Load Whisper on first ASR use so the sidecar can boot without waiting."""
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        kwargs = {"device": "cpu", "compute_type": "int8"}
        cache = os.environ.get("MELODICA_MODEL_CACHE")
        if cache:
            kwargs["download_root"] = cache
        _model = WhisperModel("base", **kwargs)
    return _model


app = FastAPI(title="Melodica Sidecar", version="1.0.0")


class TranscribeRequest(BaseModel):
    file_path: str
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None


class DetectLanguageRequest(BaseModel):
    text: str
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    file_path: Optional[str] = None


class LyricLineOut(BaseModel):
    text: str
    timestamp_ms: Optional[int] = None


class TranscribeResponse(BaseModel):
    lines: list[LyricLineOut]
    language: Optional[str] = None


class DetectLanguageResponse(BaseModel):
    language: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": "loaded" if _model is not None else "missing"}


@app.post("/transcribe")
def transcribe(req: TranscribeRequest) -> TranscribeResponse:
    model = _get_model()

    path = Path(req.file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"file not found: {req.file_path}")

    from faster_whisper.audio import decode_audio

    audio = decode_audio(str(path), sampling_rate=_SAMPLE_RATE)
    language = _resolve_whisper_language(
        audio,
        title=req.title,
        artist=req.artist,
        album=req.album,
        file_path=req.file_path,
    )

    segments, info = model.transcribe(
        audio,
        language=language,
        beam_size=1,
        condition_on_previous_text=False,
    )
    lines: list[LyricLineOut] = []
    for segment in segments:
        text = (segment.text or "").strip()
        if not text:
            continue
        lines.append(
            LyricLineOut(
                text=text,
                timestamp_ms=int(segment.start * 1000),
            )
        )

    detected = getattr(info, "language", None) or language
    return TranscribeResponse(lines=lines, language=detected)


@app.post("/detect-language")
def detect_language(req: DetectLanguageRequest) -> DetectLanguageResponse:
    """Classify the language of lyrics text (not raw audio)."""
    text = " ".join(req.text.split())
    if len(text) < 3 and not metadata_blob(
        req.title, req.artist, req.album, req.file_path
    ):
        raise HTTPException(status_code=400, detail="text too short to detect language")

    try:
        language = detect_lyrics_language(
            text,
            title=req.title,
            artist=req.artist,
            album=req.album,
            file_path=req.file_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return DetectLanguageResponse(language=language)


def _resolve_whisper_language(
    audio,
    title: Optional[str],
    artist: Optional[str],
    album: Optional[str],
    file_path: str,
) -> str | None:
    """Pick a decode language before ASR so Cantonese is not forced into Hangul."""
    meta = whisper_language_code(
        script_language(
            metadata_blob(title, artist, album, file_path),
            min_chars=2,
        )
    )
    if meta:
        return meta

    language, _prob, _ranked = _get_model().detect_language(
        audio=audio,
        vad_filter=True,
        language_detection_segments=5,
        language_detection_threshold=0.5,
    )
    if language == "ko" and _zh_fits_better_than_ko(audio):
        return "zh"
    return language


def _zh_fits_better_than_ko(audio) -> bool:
    """Score a short clip as Chinese vs Korean. Cantonese audio usually prefers zh."""
    clip = audio[: _SAMPLE_RATE * _CLIP_SECONDS]
    return _mean_logprob(clip, "zh") > _mean_logprob(clip, "ko")


def _mean_logprob(audio, language: str) -> float:
    segments, _info = _get_model().transcribe(
        audio,
        language=language,
        beam_size=1,
        without_timestamps=True,
        condition_on_previous_text=False,
    )
    scores = [segment.avg_logprob for segment in segments]
    if not scores:
        return float("-inf")
    return sum(scores) / len(scores)


@app.post("/translate-align")
def translate_align_endpoint(req: TranslateAlignRequest) -> dict:
    """Translate one or more same-language lyrics documents into the target.

    Each line returns word glosses plus a full-sentence sense. Accepts multiple
    documents so future multi-song upload can batch provider calls.
    """
    if not req.documents:
        raise HTTPException(status_code=400, detail="documents must not be empty")
    for doc in req.documents:
        if not doc.lines:
            raise HTTPException(
                status_code=400, detail=f"document {doc.id} has no lines"
            )

    try:
        result = translate_align(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return result.model_dump(by_alias=True)
