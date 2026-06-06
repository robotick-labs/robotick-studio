from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel


class HubRecord(BaseModel):
    endpoint: str
    pid: int | None = None
    workspace_root: str | None = None
    started_at: str | None = None
    tray_expected: bool = False
    tray_active: bool = False
    python_executable: str | None = None


def get_hub_record_path(workspace_root: str | Path) -> Path:
    return Path(workspace_root) / ".robotick" / "hub.json"


def write_hub_record(
    workspace_root: str | Path,
    endpoint: str,
    pid: int | None,
    *,
    tray_expected: bool = False,
    tray_active: bool = False,
    python_executable: str | None = None,
) -> HubRecord:
    record = HubRecord(
        endpoint=endpoint,
        pid=pid,
        workspace_root=str(Path(workspace_root).resolve()),
        started_at=datetime.now(timezone.utc).isoformat(),
        tray_expected=tray_expected,
        tray_active=tray_active,
        python_executable=python_executable,
    )
    record_path = get_hub_record_path(workspace_root)
    record_path.parent.mkdir(parents=True, exist_ok=True)
    record_path.write_text(f"{record.model_dump_json(indent=2)}\n", encoding="utf-8")
    return record


def remove_hub_record(workspace_root: str | Path) -> None:
    record_path = get_hub_record_path(workspace_root)
    if record_path.exists():
        record_path.unlink()
