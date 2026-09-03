#!/usr/bin/env python3
"""Copy the latest Tauri bundle into ./release, replacing the previous build."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "release"


def replace(src: Path, dest: Path) -> None:
    if dest.exists():
        if dest.is_dir():
            shutil.rmtree(dest)
        else:
            dest.unlink()
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        shutil.copytree(src, dest)
    else:
        shutil.copy2(src, dest)
    print(f"copied {src} → {dest}")


def copy_glob(folder: Path, pattern: str) -> bool:
    if not folder.is_dir():
        return False
    found = False
    for item in folder.glob(pattern):
        replace(item, DEST / item.name)
        found = True
    return found


def cargo_target_dirs() -> list[Path]:
    dirs: list[Path] = []
    env = os.environ.get("CARGO_TARGET_DIR")
    if env:
        dirs.append(Path(env))
    dirs.append(ROOT / "src-tauri" / "target")
    unique: list[Path] = []
    seen: set[Path] = set()
    for path in dirs:
        resolved = path.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(path)
    return unique


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    copied = False

    for target in cargo_target_dirs():
        bundle = target / "release" / "bundle"
        macos_app = bundle / "macos" / "Melodica.app"
        if macos_app.exists():
            replace(macos_app, DEST / "Melodica.app")
            copied = True
        copied = copy_glob(bundle / "dmg", "*.dmg") or copied
        copied = copy_glob(bundle / "nsis", "*.exe") or copied
        copied = copy_glob(bundle / "msi", "*.msi") or copied
        win_exe = target / "release" / "melodica.exe"
        if win_exe.exists():
            replace(win_exe, DEST / "Melodica.exe")
            copied = True

    if not copied:
        print(
            "no Tauri bundle found (checked CARGO_TARGET_DIR and src-tauri/target)",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
