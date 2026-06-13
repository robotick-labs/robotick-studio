from __future__ import annotations

import os
import sys
from pathlib import Path


def _owner_package_src_dirs() -> list[Path]:
    root = Path(__file__).resolve().parents[3]
    candidates = [
        root / "robotick-launcher" / "src",
        root / "robotick-studio-ability" / "src",
    ]
    return [candidate for candidate in candidates if candidate.exists()]


for src_dir in reversed(_owner_package_src_dirs()):
    src_text = os.fspath(src_dir)
    if src_text not in sys.path:
        sys.path.insert(0, src_text)


__all__ = []
