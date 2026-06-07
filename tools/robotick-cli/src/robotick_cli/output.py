from __future__ import annotations

import json
import sys
from typing import Any, TextIO


def write(text: str, stream: TextIO = sys.stdout) -> None:
    stream.write(text)


def writeln(text: str = "", stream: TextIO = sys.stdout) -> None:
    stream.write(f"{text}\n")


def write_json(payload: Any, stream: TextIO = sys.stdout) -> None:
    writeln(json.dumps(payload, indent=2), stream)
