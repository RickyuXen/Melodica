"""Melodica language sidecar — FastAPI.

Bound to localhost only. Provides ASR transcription and language detection.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from langdetect import DetectorFactory, LangDetectException, detect
from pydantic import BaseModel

# Deterministic langdetect results across runs.
DetectorFactory.seed = 0

_model = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _model
    from faster_whisper import WhisperModel

    # Small CPU-friendly model; downloaded once on first start.
    _model = WhisperModel("base", device="cpu", compute_type="int8")
    yield
    _model = None


app = FastAPI(title="Melodica Sidecar", version="0.1.0", lifespan=lifespan)


class TranscribeRequest(BaseModel):
    file_path: str


class DetectLanguageRequest(BaseModel):
    text: str


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
    if _model is None:
        raise HTTPException(status_code=503, detail="Whisper model is not loaded")

    path = Path(req.file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"file not found: {req.file_path}")

    segments, info = _model.transcribe(str(path), beam_size=1)
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

    language = getattr(info, "language", None)
    return TranscribeResponse(lines=lines, language=language)


@app.post("/detect-language")
def detect_language(req: DetectLanguageRequest) -> DetectLanguageResponse:
    """Classify the language of lyrics text (not raw audio)."""
    text = " ".join(req.text.split())
    if len(text) < 3:
        raise HTTPException(status_code=400, detail="text too short to detect language")

    try:
        language = detect(text)
    except LangDetectException as exc:
        raise HTTPException(
            status_code=422, detail=f"could not detect language: {exc}"
        ) from exc

    return DetectLanguageResponse(language=language)


# Future endpoints (see plan.md):
# - POST /fetch-lyrics
# - POST /translate-align
