from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _launcher_state_root(workspace_root: str | Path) -> Path:
    return Path(workspace_root).resolve() / ".robotick" / "launcher"


def _read_json_records(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for candidate in sorted(path.glob("*.json")):
        try:
            payload = json.loads(candidate.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(payload, dict):
            records.append(payload)
    return records


def list_model_session_groups(
    workspace_root: str | Path,
    *,
    project_id: str | None = None,
) -> list[dict[str, Any]]:
    groups = _read_json_records(_launcher_state_root(workspace_root) / "model-session-groups")
    if project_id is not None:
        groups = [group for group in groups if group.get("project_id") == project_id]
    return groups


def get_model_session_group(
    workspace_root: str | Path,
    group_id: str,
) -> dict[str, Any] | None:
    path = _launcher_state_root(workspace_root) / "model-session-groups" / f"{group_id}.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def list_model_sessions(
    workspace_root: str | Path,
    *,
    group_id: str | None = None,
    project_id: str | None = None,
) -> list[dict[str, Any]]:
    sessions = _read_json_records(_launcher_state_root(workspace_root) / "model-sessions")
    if group_id is not None:
        sessions = [session for session in sessions if session.get("group_id") == group_id]
    if project_id is not None:
        sessions = [session for session in sessions if session.get("project_id") == project_id]
    return sessions


def get_model_session(
    workspace_root: str | Path,
    session_id: str,
) -> dict[str, Any] | None:
    path = _launcher_state_root(workspace_root) / "model-sessions" / f"{session_id}.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None
