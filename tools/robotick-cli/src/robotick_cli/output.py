from __future__ import annotations

import json
import os
import sys
from typing import Any, TextIO


def write(text: str, stream: TextIO = sys.stdout) -> None:
    stream.write(text)


def writeln(text: str = "", stream: TextIO = sys.stdout) -> None:
    stream.write(f"{text}\n")


def write_json(payload: Any, stream: TextIO = sys.stdout) -> None:
    writeln(json.dumps(payload, indent=2), stream)


def stream_supports_color(stream: TextIO = sys.stdout) -> bool:
    if os.environ.get("NO_COLOR") is not None:
        return False
    if os.environ.get("TERM") == "dumb":
        return False
    isatty = getattr(stream, "isatty", None)
    return bool(callable(isatty) and isatty())
