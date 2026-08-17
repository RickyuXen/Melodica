"""Melodica language sidecar — FastAPI.

Bound to localhost only. Provides ASR transcription via faster-whisper.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

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


class LyricLineOut(BaseModel):
    text: str
    timestamp_ms: Optional[int] = None


class TranscribeResponse(BaseModel):
    lines: list[LyricLineOut]


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

    segments, _info = _model.transcribe(str(path), beam_size=1)
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

    return TranscribeResponse(lines=lines)


# Future endpoints (see plan.md):
# - POST /detect-language
# - POST /fetch-lyrics
# - POST /translate-align
