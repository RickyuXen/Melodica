"""Frozen / production entry for the language sidecar."""

from __future__ import annotations

import uvicorn

from app.main import app


def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")


if __name__ == "__main__":
    main()
