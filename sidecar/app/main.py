"""Melodica language sidecar — FastAPI stub.

Bound to localhost only. Not wired into the Tauri app yet.
"""

from fastapi import FastAPI

app = FastAPI(title="Melodica Sidecar", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Future endpoints (see plan.md):
# - POST /detect-language
# - POST /fetch-lyrics
# - POST /translate-align
# - POST /transcribe
