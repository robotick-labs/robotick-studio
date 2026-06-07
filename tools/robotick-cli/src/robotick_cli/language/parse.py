from __future__ import annotations

import shlex


def tokenize(line: str) -> list[str]:
    return shlex.split(line, comments=False, posix=True)
