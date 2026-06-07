from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal


ShellNamespace = Literal["studio", "hub", "launcher"] | None


@dataclass
class AppContext:
    workspace_root: Path


@dataclass
class ShellState:
    namespace: ShellNamespace = None
    instance_name: str | None = None
