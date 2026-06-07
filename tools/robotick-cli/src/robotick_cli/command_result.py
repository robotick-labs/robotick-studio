from __future__ import annotations

from dataclasses import dataclass


@dataclass
class CommandResult:
    exit_code: int
    opened_instance_name: str | None = None
