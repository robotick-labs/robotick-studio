from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

from rich import print

RUNTIME_LOCK_FILENAME = "runtime-lock.json"


def get_runtime_lock_path(project_dir: Path, project_safe: str) -> Path:
    return (
        project_dir
        / ".launcher"
        / project_safe
        / "deps"
        / "runtime"
        / RUNTIME_LOCK_FILENAME
    )


def load_runtime_lock(
    project_dir: Path, project_safe: str
) -> Optional[Dict[str, Any]]:
    lock_path = get_runtime_lock_path(project_dir, project_safe)
    if not lock_path.exists():
        return None
    try:
        return json.loads(lock_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(
            f"[yellow]⚠️ Failed to parse runtime lockfile:[/] {lock_path} ({exc})"
        )
        return None


def write_runtime_lock(
    project_dir: Path,
    project_safe: str,
    payload: Dict[str, Any],
    *,
    dry_run: bool = False,
) -> None:
    lock_path = get_runtime_lock_path(project_dir, project_safe)
    if dry_run:
        print(f"[yellow]DRY RUN:[/] would write runtime lockfile {lock_path}")
        return
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"[green]🔒 Wrote runtime deps lock:[/] {lock_path}")


def apply_runtime_lock(
    runtime_cfg: Dict[str, Any],
    project_dir: Path,
    project_safe: str,
    target: Optional[str],
) -> None:
    if not target or not runtime_cfg:
        return
    data = load_runtime_lock(project_dir, project_safe)
    if not data:
        return
    targets = data.get("targets") or {}
    target_blob = targets.get(target)
    if not target_blob:
        return

    engine_entry = runtime_cfg.get("engine")
    if isinstance(engine_entry, dict):
        _apply_lock_entry(engine_entry, target_blob.get("engine"))

    for category in ("workload_sources", "shared"):
        entries = runtime_cfg.get(category) or []
        if not isinstance(entries, list):
            continue
        lock_entries = target_blob.get(category) or []
        lock_map = {_lock_key(le): le for le in lock_entries if _lock_key(le)}
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            key = _lock_key(entry)
            if not key:
                continue
            lock_entry = lock_map.get(key)
            if lock_entry:
                _apply_lock_entry(entry, lock_entry)


def _lock_key(entry: Dict[str, Any]) -> Optional[str]:
    entry_id = entry.get("id")
    if entry_id:
        return f"id:{entry_id}"
    repo = entry.get("repo")
    if repo:
        return f"repo:{repo}"
    return None


def _apply_lock_entry(
    runtime_entry: Dict[str, Any], lock_entry: Optional[Dict[str, Any]]
) -> None:
    if not lock_entry:
        return
    path = lock_entry.get("path")
    if not path:
        return
    runtime_entry["path_override"] = path
