from __future__ import annotations
from pathlib import Path

from pydantic import BaseModel

from robotick_cli.app.errors import HubUnavailableError


class HubRecord(BaseModel):
    endpoint: str
    pid: int | None = None
    workspace_root: str | None = None


def get_hub_record_path(workspace_root: str | Path) -> Path:
    return Path(workspace_root) / ".robotick" / "hub.json"


def discover_hub(workspace_root: str | Path) -> HubRecord | None:
    record_path = get_hub_record_path(workspace_root)
    if not record_path.exists():
        return None
    return HubRecord.model_validate_json(record_path.read_text(encoding="utf-8"))


def ensure_hub(workspace_root: str | Path) -> HubRecord:
    record = discover_hub(workspace_root)
    if record is None:
        raise HubUnavailableError("robotick-hub is not available yet.")
    return record
