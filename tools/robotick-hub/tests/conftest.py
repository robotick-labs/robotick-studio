from __future__ import annotations

import sys
from pathlib import Path


TESTS_DIR = Path(__file__).resolve().parent
TOOLS_DIR = TESTS_DIR.parent.parent
SRC_DIRS = [
    TOOLS_DIR / "robotick-hub" / "src",
    TOOLS_DIR / "robotick-launcher" / "src",
    TOOLS_DIR / "robotick-studio-ability" / "src",
]

for src_dir in reversed(SRC_DIRS):
    src_text = str(src_dir)
    if src_text not in sys.path:
        sys.path.insert(0, src_text)
