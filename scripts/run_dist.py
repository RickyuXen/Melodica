#!/usr/bin/env python3
"""Build Melodica and copy the standalone app into ./release (replaced each run)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    env = os.environ.copy()
    env["CARGO_TARGET_DIR"] = str(ROOT / "src-tauri" / "target")
    subprocess.check_call(
        ["npm", "run", "tauri:build"],
        cwd=ROOT,
        env=env,
    )
    subprocess.check_call(
        [sys.executable, str(ROOT / "scripts" / "copy_release.py")],
        cwd=ROOT,
        env=env,
    )


if __name__ == "__main__":
    main()
