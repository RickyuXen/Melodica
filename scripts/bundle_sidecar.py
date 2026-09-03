#!/usr/bin/env python3
"""Freeze the FastAPI sidecar into Tauri's externalBin naming scheme.

Production: PyInstaller one-file binary.
Development (`--dev`): a small launcher that runs the Python package in-place
so `tauri dev` still works before a freeze exists.

Rebuilds are skipped when sidecar sources are unchanged unless `--force`.
"""

from __future__ import annotations

import hashlib
import os
import stat
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SIDECAR = ROOT / "sidecar"
BINARIES = ROOT / "src-tauri" / "binaries"
DIGEST_NAME = ".sidecar-source.sha256"

DEV_LAUNCHER = '''#!/usr/bin/env python3
"""Dev-only sidecar launcher used when a frozen binary is not present."""
import os
import sys
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
sidecar = repo / "sidecar"
sys.path.insert(0, str(sidecar))
os.chdir(sidecar)

from run import main

if __name__ == "__main__":
    main()
'''


def host_triple() -> str:
    out = subprocess.check_output(["rustc", "-vV"], text=True)
    for line in out.splitlines():
        if line.startswith("host:"):
            return line.split()[1]
    raise SystemExit("could not detect rustc host triple")


def dest_path(triple: str) -> Path:
    suffix = ".exe" if "windows" in triple else ""
    return BINARIES / f"melodica-sidecar-{triple}{suffix}"


def sources_digest() -> str:
    hasher = hashlib.sha256()
    files = [SIDECAR / "requirements.txt", SIDECAR / "run.py"]
    files.extend(sorted((SIDECAR / "app").rglob("*.py")))
    for path in files:
        if path.is_file():
            hasher.update(path.as_posix().encode())
            hasher.update(path.read_bytes())
    return hasher.hexdigest()


def digest_file(dest: Path) -> Path:
    return dest.with_name(DIGEST_NAME)


def is_script(path: Path) -> bool:
    if not path.is_file():
        return False
    with path.open("rb") as handle:
        return handle.read(2) == b"#!"


def write_dev_launcher(dest: Path) -> None:
    BINARIES.mkdir(parents=True, exist_ok=True)
    dest.write_text(DEV_LAUNCHER, encoding="utf-8")
    dest.chmod(dest.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    print(f"wrote dev sidecar launcher → {dest}")


def python_for_freeze() -> Path:
    venv = SIDECAR / ".venv"
    if sys.platform == "win32":
        py = venv / "Scripts" / "python.exe"
    else:
        py = venv / "bin" / "python"
    if not py.exists():
        subprocess.check_call([sys.executable, "-m", "venv", str(venv)])
    return py


def freeze(dest: Path) -> None:
    BINARIES.mkdir(parents=True, exist_ok=True)
    py = python_for_freeze()
    subprocess.check_call(
        [
            str(py),
            "-m",
            "pip",
            "install",
            "-q",
            "-U",
            "pip",
            "-r",
            str(SIDECAR / "requirements.txt"),
            "-r",
            str(SIDECAR / "requirements-build.txt"),
        ]
    )
    work = SIDECAR / "build" / "pyinstaller"
    dist = SIDECAR / "dist"
    work.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(py),
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        "melodica-sidecar",
        "--distpath",
        str(dist),
        "--workpath",
        str(work),
        "--specpath",
        str(work),
        "--paths",
        str(SIDECAR),
        "--collect-all",
        "faster_whisper",
        "--collect-all",
        "ctranslate2",
        "--collect-all",
        "av",
        "--collect-submodules",
        "uvicorn",
        "--collect-submodules",
        "app",
        "--hidden-import",
        "uvicorn.logging",
        "--hidden-import",
        "uvicorn.loops.auto",
        "--hidden-import",
        "uvicorn.protocols.http.auto",
        "--hidden-import",
        "uvicorn.lifespan.on",
        "--hidden-import",
        "langdetect",
        str(SIDECAR / "run.py"),
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(SIDECAR) + os.pathsep + env.get("PYTHONPATH", "")
    subprocess.check_call(cmd, cwd=SIDECAR, env=env)
    candidates = [
        dist / "melodica-sidecar.exe",
        dist / "melodica-sidecar",
    ]
    built = next((p for p in candidates if p.exists()), None)
    if built is None:
        raise SystemExit(f"PyInstaller did not produce a sidecar in {dist}")
    dest.write_bytes(built.read_bytes())
    dest.chmod(dest.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    print(f"froze sidecar → {dest}")


def main() -> None:
    dev = "--dev" in sys.argv
    force = "--force" in sys.argv
    triple = host_triple()
    dest = dest_path(triple)
    digest = sources_digest()
    stamp = digest_file(dest)

    if not force and dest.exists() and not is_script(dest) and stamp.exists():
        if stamp.read_text(encoding="utf-8").strip() == digest:
            print(f"sidecar binary up to date → {dest}")
            return

    if dev and not force:
        if dest.exists() and not is_script(dest):
            print(f"using existing frozen sidecar → {dest}")
            return
        write_dev_launcher(dest)
        return

    freeze(dest)
    stamp.write_text(digest + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
