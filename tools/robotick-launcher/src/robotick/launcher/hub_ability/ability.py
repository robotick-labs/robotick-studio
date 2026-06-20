from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime, timezone
import hashlib
import importlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import uuid
from typing import Any
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, model_validator

from robotick_hub.abilities.base import AbilityManifest, AbilityStatus, HubContext
from robotick_hub.workspace import list_workspace_project_paths

class LauncherRuntimeSelectionRequest(BaseModel):
    project_id: str | None = None
    model_ids: list[str] = Field(default_factory=list)


class LauncherModelLaunchRequest(BaseModel):
    project_name: str
    profile: str | None = None
    intent: dict[str, Any] | None = None
    creator: dict[str, Any] = Field(default_factory=dict)
    clear_logs: bool = False
    wait: bool = False

    @model_validator(mode="after")
    def validate_request(self) -> "LauncherModelLaunchRequest":
        if not self.profile and not self.intent:
            raise ValueError("Either 'profile' or 'intent' must be provided.")
        if self.profile and self.intent:
            raise ValueError("Provide either 'profile' or 'intent', not both.")
        return self


class LauncherModelControlRequest(BaseModel):
    project_name: str
    model_ids: list[str] = Field(default_factory=list)
    profile: str | None = None
    intent: dict[str, Any] | None = None
    creator: dict[str, Any] = Field(default_factory=dict)
    clear_logs: bool = False
    wait: bool = False


class LauncherModelLogsClearRequest(BaseModel):
    project_id: str
    model_ids: list[str] = Field(default_factory=list)


def _ensure_launcher_import_path() -> None:
    launcher_src = Path(__file__).resolve().parents[3].parent / "robotick-launcher" / "src"
    launcher_src_text = str(launcher_src)
    if launcher_src_text not in sys.path:
        sys.path.insert(0, launcher_src_text)


def _launcher_domain() -> Any:
    _ensure_launcher_import_path()
    import robotick.launcher.domain as launcher_domain

    return launcher_domain


def _launcher_query() -> Any:
    _ensure_launcher_import_path()
    return importlib.import_module("robotick.launcher.domain.query")


def _launcher_list_project_models() -> Any:
    _ensure_launcher_import_path()
    from robotick.launcher.actions.query.list import list_project_models

    return list_project_models


def _launcher_run_profile_module() -> Any:
    _ensure_launcher_import_path()
    from robotick.launcher.actions.launch import run_profile as run_profile_module

    return run_profile_module


def _launcher_config_class() -> Any:
    _ensure_launcher_import_path()
    from robotick.launcher.config import Config

    return Config


def _launcher_target_plan_module() -> Any:
    _ensure_launcher_import_path()
    from robotick.launcher.actions.launch.target_plan import resolve_target_plan

    return resolve_target_plan


def _launcher_utils() -> Any:
    _ensure_launcher_import_path()
    from robotick.launcher.utils import get_launcher_paths, stop_local_binary_process

    return get_launcher_paths, stop_local_binary_process


def _launcher_cli_module_name() -> str:
    return "robotick.launcher.cli"


def _launcher_src_dir() -> Path:
    return Path(__file__).resolve().parents[3].parent / "robotick-launcher" / "src"


def _resolve_project_path(workspace_root: str, project_name: str) -> Path:
    for candidate in list_workspace_project_paths(workspace_root):
        path = Path(candidate).resolve()
        if path.stem.removesuffix(".project") == project_name:
            return path
    raise FileNotFoundError(f"Project '{project_name}' is not registered in this workspace.")


def _workspace_id(workspace_root: str) -> str:
    return Path(workspace_root).resolve().name


def _json_store(workspace_root: str):
    domain = _launcher_domain()
    return domain.LauncherSessionStore(workspace_root)


def _runtime_phonebook_dir(workspace_root: str) -> Path:
    path = Path(workspace_root).resolve() / ".robotick" / "launcher" / "model-runtimes"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _runtime_phonebook_key(project_id: str, model_id: str) -> str:
    identity = f"{project_id.strip()}::{model_id.strip()}"
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
    return f"{project_id.strip()}--{model_id.strip()}--{digest}"


def _runtime_phonebook_path(workspace_root: str, project_id: str, model_id: str) -> Path:
    return _runtime_phonebook_dir(workspace_root) / f"{_runtime_phonebook_key(project_id, model_id)}.json"


def _write_runtime_phonebook_record(workspace_root: str, record: dict[str, Any]) -> dict[str, Any]:
    now = _utc_now().isoformat()
    project_id = str(record.get("project_id") or "").strip()
    model_id = str(record.get("model_id") or "").strip()
    if not project_id or not model_id:
        raise ValueError("Runtime phone-book records require project_id and model_id.")
    path = _runtime_phonebook_path(workspace_root, project_id, model_id)
    previous: dict[str, Any] = {}
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                previous = loaded
        except (OSError, json.JSONDecodeError):
            previous = {}
    payload = {
        **previous,
        **record,
        "resource_type": "launcher_model_runtime",
        "id": f"lmr_{_runtime_phonebook_key(project_id, model_id)}",
        "project_id": project_id,
        "model_id": model_id,
        "created_at": previous.get("created_at") or now,
        "updated_at": now,
    }
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf-8")
    return payload


def _list_runtime_phonebook_records(
    workspace_root: str,
    *,
    project_id: str | None = None,
    model_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    wanted_models = {model_id.strip() for model_id in model_ids or [] if model_id.strip()}
    records: list[dict[str, Any]] = []
    for path in sorted(_runtime_phonebook_dir(workspace_root).glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        if project_id is not None and payload.get("project_id") != project_id:
            continue
        if wanted_models and payload.get("model_id") not in wanted_models:
            continue
        records.append(payload)
    return _cull_absent_model_phonebook_records(workspace_root, records)


def _declared_project_model_ids(workspace_root: str, project_id: str) -> set[str] | None:
    try:
        project_path = _resolve_project_path(workspace_root, project_id)
    except FileNotFoundError:
        return None
    list_project_models = _launcher_list_project_models()
    try:
        model_paths = list_project_models(str(project_path))
    except FileNotFoundError:
        return None
    return {Path(path).stem.removesuffix(".model") for path in model_paths}


def _cull_absent_model_phonebook_records(
    workspace_root: str,
    records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    declared_by_project: dict[str, set[str] | None] = {}
    kept: list[dict[str, Any]] = []
    for record in records:
        project_id = str(record.get("project_id") or "").strip()
        model_id = str(record.get("model_id") or "").strip()
        if not project_id or not model_id:
            kept.append(record)
            continue
        if project_id not in declared_by_project:
            declared_by_project[project_id] = _declared_project_model_ids(workspace_root, project_id)
        declared_model_ids = declared_by_project[project_id]
        if declared_model_ids is None or model_id in declared_model_ids:
            kept.append(record)
            continue
        try:
            _runtime_phonebook_path(workspace_root, project_id, model_id).unlink(missing_ok=True)
        except OSError:
            pass
    return kept


def _runtime_phonebook_record_from_session(
    workspace_root: str,
    session: Any,
    *,
    project_path: str | None = None,
    operation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    runtime = dict(session.runtime or {})
    worker = dict(runtime.get("worker") or {})
    probe = dict(runtime.get("probe") or {})
    target = session.target.model_dump(mode="json") if hasattr(session.target, "model_dump") else dict(session.target or {})
    return {
        "project_id": session.project_id,
        "project_path": project_path or str(_resolve_project_path(workspace_root, session.project_id)),
        "model_id": session.model_id,
        "target": target,
        "pid": worker.get("pid"),
        "command": worker.get("command"),
        "log_path": worker.get("log_path"),
        "telemetry_host": probe.get("host"),
        "telemetry_port": probe.get("port"),
        "telemetry_url": probe.get("telemetry_url"),
        "health_urls": list(probe.get("health_urls") or []),
        "last_session_id": session.id,
        "operation": operation,
        "last_known_runtime": runtime,
    }


def _runtime_phonebook_record(
    workspace_root: str,
    project_id: str,
    model_id: str,
) -> dict[str, Any] | None:
    path = _runtime_phonebook_path(workspace_root, project_id, model_id)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _runtime_phonebook_record_needs_session_hydration(record: dict[str, Any]) -> bool:
    if not str(record.get("last_session_id") or "").strip():
        return False
    has_worker_ref = bool(record.get("pid") or record.get("log_path"))
    has_probe_ref = bool(record.get("telemetry_url") or record.get("telemetry_port") or record.get("health_urls"))
    return not (has_worker_ref and has_probe_ref)


def _runtime_has_probe_metadata(runtime: dict[str, Any]) -> bool:
    probe = runtime.get("probe")
    return isinstance(probe, dict) and bool(probe)


def _runtime_with_probe_metadata(
    workspace_root: str,
    record: dict[str, Any],
    session: Any,
) -> dict[str, Any]:
    runtime = dict(session.runtime or {})
    if _runtime_has_probe_metadata(runtime):
        return runtime

    project_id = str(record.get("project_id") or session.project_id)
    project_path_text = str(record.get("project_path") or "").strip()
    project_path = Path(project_path_text) if project_path_text else _resolve_project_path(workspace_root, project_id)
    runtime_metadata = _session_probe_metadata(
        workspace_root,
        project_id,
        project_path.parent.resolve(),
        session,
    )
    if not runtime_metadata:
        return runtime
    return {
        **runtime,
        **runtime_metadata,
    }


def _hydrate_runtime_phonebook_record_from_session(
    workspace_root: str,
    record: dict[str, Any],
) -> dict[str, Any]:
    operation = _operation_in_flight(record)
    if (
        operation is not None
        and operation.get("action") in {"stopping", "restarting"}
        and not operation.get("queued")
    ):
        return record
    if operation is not None and operation.get("action") == "stopping":
        operation = None
    if not _runtime_phonebook_record_needs_session_hydration(record):
        if operation is None and isinstance(record.get("operation"), dict):
            return _write_runtime_phonebook_record(workspace_root, {**record, "operation": None})
        return record

    session_id = str(record.get("last_session_id") or "").strip()
    store = _json_store(workspace_root)
    session = store.get_session(session_id)
    if session is None:
        return record
    if session.project_id != record.get("project_id") or session.model_id != record.get("model_id"):
        return record
    if not _session_is_active(session):
        return record

    runtime = _runtime_with_probe_metadata(workspace_root, record, session)
    if runtime != dict(session.runtime or {}):
        session = session.model_copy(
            update={
                "runtime": runtime,
                "updated_at": _utc_now(),
            }
        )
        session = store.update_session(session)
    worker = dict(runtime.get("worker") or {})
    probe = dict(runtime.get("probe") or {})
    if not worker.get("pid") and not worker.get("log_path") and not probe.get("health_urls"):
        return record

    pid = worker.get("pid")
    worker_alive = _pid_alive(int(pid)) if isinstance(pid, int) or str(pid).isdigit() else False
    reconciled = _reconcile_session_runtime_state(
        workspace_root,
        session,
        worker_alive=worker_alive,
    )
    if reconciled != session:
        session = store.update_session(reconciled)
        group = store.get_group(session.group_id)
        if group is not None:
            _refresh_group_record(store, _launcher_domain(), group)

    hydrated_operation = operation
    if operation is not None and operation.get("queued") and worker_alive:
        hydrated_operation = None

    return _write_runtime_phonebook_record(
        workspace_root,
        _runtime_phonebook_record_from_session(
            workspace_root,
            session,
            project_path=record.get("project_path"),
            operation=hydrated_operation,
        ),
    )


def _new_operation_request_id(action: str) -> str:
    return f"{action}-{uuid.uuid4().hex[:12]}"


def _publish_provisional_runtime_operations(
    workspace_root: str,
    *,
    project_id: str,
    project_path: Path,
    model_ids: list[str],
    action: str,
    request_id: str,
    overwrite_active: bool = False,
    clear_session_id: bool = True,
) -> None:
    started_at = _utc_now().isoformat()
    for model_id in model_ids:
        normalized_model_id = str(model_id or "").strip()
        if not normalized_model_id:
            continue
        existing = _runtime_phonebook_record(workspace_root, project_id, normalized_model_id)
        if (
            not overwrite_active
            and existing is not None
            and _runtime_model_blocks_launch(_runtime_live_projection(existing))
        ):
            continue
        record = {
            "project_id": project_id,
            "project_path": str(project_path),
            "model_id": normalized_model_id,
            "target": {},
            "pid": None,
            "command": None,
            "log_path": None,
            "telemetry_host": None,
            "telemetry_port": None,
            "telemetry_url": None,
            "health_urls": [],
            "operation": {
                "action": action,
                "pid": None,
                "command": None,
                "log_path": None,
                "started_at": started_at,
                "request_id": request_id,
            },
            "last_known_runtime": {},
        }
        if clear_session_id:
            record["last_session_id"] = None
        _write_runtime_phonebook_record(workspace_root, record)


def _model_ids_from_intent_scope(intent: dict[str, Any] | None) -> list[str]:
    scope = dict((intent or {}).get("scope") or {})
    kind = str(scope.get("kind") or "").strip().lower()
    value = scope.get("value")
    if kind == "model" and isinstance(value, str) and value.strip():
        return [value.strip()]
    if kind == "models" and isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _request_targets_all_models(request: Any) -> bool:
    intent = getattr(request, "intent", None)
    scope = dict((intent or {}).get("scope") or {}) if isinstance(intent, dict) else {}
    kind = str(scope.get("kind") or "").strip().lower()
    value = str(scope.get("value") or "").strip().lower()
    if kind == "all" or value == "all":
        return True
    profile = str(getattr(request, "profile", None) or "").strip()
    return profile.upper().endswith(":ALL")


def _request_target_policy(request: Any) -> str | None:
    intent = getattr(request, "intent", None)
    if isinstance(intent, dict):
        target_policy = str(intent.get("target_policy") or "").strip()
        if target_policy:
            return target_policy
    profile = str(getattr(request, "profile", None) or "").strip()
    if ":" in profile:
        target_policy = profile.split(":", 1)[0].strip()
        if target_policy:
            return target_policy
    return None


def _provisional_launch_model_ids(
    workspace_root: str,
    project_id: str,
    request: Any,
) -> list[str]:
    model_ids = [str(item).strip() for item in getattr(request, "model_ids", []) if str(item).strip()]
    if model_ids:
        return model_ids
    model_ids = _model_ids_from_intent_scope(getattr(request, "intent", None))
    if model_ids:
        return model_ids
    if _request_targets_all_models(request):
        return sorted(_declared_project_model_ids(workspace_root, project_id) or [])
    return []


def _launcher_log_root(workspace_root: str) -> Path:
    path = Path(workspace_root).resolve() / ".robotick" / "logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_launcher_log_path(workspace_root: str, raw_path: Any) -> Path | None:
    if not isinstance(raw_path, str) or not raw_path.strip():
        return None
    try:
        path = Path(raw_path).expanduser().resolve()
        path.relative_to(_launcher_log_root(workspace_root).resolve())
    except (OSError, ValueError):
        return None
    return path


def _source_key(source_kind: str, path: Path) -> str:
    return f"{source_kind}:{path}"


def _log_clear_offsets(record: dict[str, Any]) -> dict[str, int]:
    raw_offsets = record.get("log_clear_offsets")
    if not isinstance(raw_offsets, dict):
        return {}
    offsets: dict[str, int] = {}
    for key, value in raw_offsets.items():
        if isinstance(key, str) and isinstance(value, int) and value >= 0:
            offsets[key] = value
    return offsets


def _read_log_offset(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _log_file_timestamp(path: Path) -> str:
    try:
        modified_at = path.stat().st_mtime
    except OSError:
        return _utc_now().isoformat()
    return datetime.fromtimestamp(modified_at, timezone.utc).isoformat()


def _read_log_lines(path: Path, *, offset: int = 0, tail: int = 200) -> tuple[list[tuple[int, str]], int]:
    if tail < 0:
        tail = 0
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            handle.seek(max(0, offset))
            lines: list[tuple[int, str]] | deque[tuple[int, str]]
            if tail:
                lines = deque(maxlen=tail)
            else:
                lines = []
            while True:
                start = handle.tell()
                line = handle.readline()
                if not line:
                    break
                lines.append((start, line.rstrip("\n")))
            end_offset = handle.tell()
    except OSError:
        return [], offset
    return list(lines), end_offset


def _model_log_sources(
    workspace_root: str,
    *,
    project_id: str,
    model_id: str,
) -> list[dict[str, Any]]:
    record = _runtime_phonebook_record(workspace_root, project_id, model_id) or {}
    sources: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add_source(source_kind: str, raw_path: Any, label: str) -> None:
        path = _safe_launcher_log_path(workspace_root, raw_path)
        if path is None:
            return
        key = (source_kind, str(path))
        if key in seen:
            return
        seen.add(key)
        sources.append(
            {
                "source_kind": source_kind,
                "path": str(path),
                "label": label,
            }
        )

    add_source("launcher-worker", record.get("log_path"), "launcher worker")
    operation = record.get("operation")
    if isinstance(operation, dict):
        action = str(operation.get("action") or "").strip()
        if action in {"stopping", "restarting"}:
            add_source("launcher-control", operation.get("log_path"), "launcher control")

    runtime = record.get("last_known_runtime")
    if isinstance(runtime, dict):
        control = runtime.get("control")
        if isinstance(control, dict):
            add_source("launcher-control", control.get("log_path"), "launcher control")
        model_runtime = runtime.get("model_runtime")
        if isinstance(model_runtime, dict):
            add_source("model-runtime", model_runtime.get("log_path"), "model runtime")

    return sources


def _model_log_snapshot(
    workspace_root: str,
    *,
    project_id: str,
    model_id: str,
    tail: int = 200,
) -> dict[str, Any]:
    record = _runtime_phonebook_record(workspace_root, project_id, model_id) or {}
    clear_offsets = _log_clear_offsets(record)
    source_payloads = []
    events = []
    for source in _model_log_sources(workspace_root, project_id=project_id, model_id=model_id):
        path = Path(source["path"])
        key = _source_key(source["source_kind"], path)
        clear_offset = clear_offsets.get(key, 0)
        lines, end_offset = _read_log_lines(path, offset=clear_offset, tail=tail)
        timestamp = _log_file_timestamp(path)
        source_payloads.append(
            {
                **source,
                "clear_offset": clear_offset,
                "read_offset": end_offset,
                "available": path.exists(),
            }
        )
        for offset, line in lines:
            events.append(
                {
                    "project_id": project_id,
                    "model_id": model_id,
                    "source_kind": source["source_kind"],
                    "path": str(path),
                    "offset": offset,
                    "line": line,
                    "timestamp": timestamp,
                }
            )
    events.sort(key=lambda item: (str(item["path"]), int(item["offset"])))
    return {
        "resource_type": "robotick_launcher_model_logs",
        "project_id": project_id,
        "model_id": model_id,
        "sources": source_payloads,
        "events": events,
    }


def _clear_model_log_offsets(
    workspace_root: str,
    *,
    project_id: str,
    model_ids: list[str],
) -> list[dict[str, Any]]:
    cleared: list[dict[str, Any]] = []
    for model_id in model_ids:
        record = _runtime_phonebook_record(workspace_root, project_id, model_id)
        if record is None:
            continue
        offsets = _log_clear_offsets(record)
        sources = _model_log_sources(workspace_root, project_id=project_id, model_id=model_id)
        for source in sources:
            path = Path(source["path"])
            offsets[_source_key(source["source_kind"], path)] = _read_log_offset(path)
        _write_runtime_phonebook_record(
            workspace_root,
            {
                **record,
                "project_id": project_id,
                "model_id": model_id,
                "log_clear_offsets": offsets,
            },
        )
        cleared.append(
            {
                "model_id": model_id,
                "sources": sources,
            }
        )
    return cleared


def _all_runtime_model_ids(workspace_root: str, project_id: str) -> list[str]:
    records = _list_runtime_phonebook_records(workspace_root, project_id=project_id)
    return sorted(
        str(record.get("model_id") or "").strip()
        for record in records
        if str(record.get("model_id") or "").strip()
    )


def _set_runtime_operation(
    workspace_root: str,
    session: Any,
    *,
    project_path: str | None = None,
    action: str,
    pid: int | None,
    command: list[str] | None,
    log_path: str | None,
    request_id: str | None = None,
) -> None:
    operation = {
        "action": action,
        "pid": pid,
        "command": command,
        "log_path": log_path,
        "started_at": _utc_now().isoformat(),
    }
    if request_id:
        operation["request_id"] = request_id
    _write_runtime_phonebook_record(
        workspace_root,
        _runtime_phonebook_record_from_session(
            workspace_root,
            session,
            project_path=project_path,
            operation=operation,
        ),
    )


def _clear_runtime_operation(
    workspace_root: str,
    session: Any,
    *,
    project_path: str | None = None,
    result: dict[str, Any] | None = None,
) -> None:
    record = _runtime_phonebook_record_from_session(
        workspace_root,
        session,
        project_path=project_path,
        operation=None,
    )
    if result:
        record["last_operation_result"] = result
    _write_runtime_phonebook_record(workspace_root, record)


def _clear_queued_runtime_operations(
    workspace_root: str,
    *,
    project_id: str,
    model_ids: list[str],
    reason: str,
) -> list[dict[str, Any]]:
    selected = {str(model_id).strip() for model_id in model_ids if str(model_id).strip()}
    cleared: list[dict[str, Any]] = []
    for record in _list_runtime_phonebook_records(workspace_root, project_id=project_id):
        model_id = str(record.get("model_id") or "").strip()
        if not model_id:
            continue
        if selected and model_id not in selected:
            continue
        operation = _operation_in_flight(record)
        if operation is None or not operation.get("queued"):
            continue
        updated = {
            **record,
            "operation": None,
            "last_operation_result": {
                "action": operation.get("action"),
                "result": "cancelled_by_stop",
                "reason": reason,
                "finished_at": _utc_now().isoformat(),
            },
        }
        _write_runtime_phonebook_record(workspace_root, updated)
        cleared.append(
            {
                "project_id": project_id,
                "model_id": model_id,
                "operation": operation,
            }
        )
    return cleared


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


STOP_SUCCESS_CLEARED_DIAGNOSTIC_CODES = {
    "restart_stop_worker_failed",
    "runtime_probe_stale",
    "runtime_probe_unreachable",
    "stop_worker_failed",
    "worker_exited_after_runtime_handoff",
}

OPERATION_QUEUED_GRACE_SECONDS = 120.0

_OPERATION_LOCK = threading.RLock()
_OPERATION_RECORDS: dict[str, dict[str, Any]] = {}
_OPERATION_GROUPS: dict[str, dict[str, Any]] = {}
_TERMINAL_OPERATION_PHASES = {
    "succeeded",
    "failed",
    "cancelled",
    "cancelled_by_stop",
    "expired",
}


def _without_diagnostics(diagnostics: list[Any], codes: set[str]) -> list[Any]:
    return [diagnostic for diagnostic in diagnostics if getattr(diagnostic, "code", None) not in codes]


def _new_operation_group_id(action: str) -> str:
    return f"{action}-group-{uuid.uuid4().hex[:12]}"


def _create_operation_group(
    *,
    workspace_root: str,
    action: str,
    project_id: str,
    model_ids: list[str],
    creator: dict[str, Any] | None = None,
    target_policy: str | None = None,
) -> dict[str, Any]:
    now = _utc_now().isoformat()
    normalized_workspace_root = str(Path(workspace_root).resolve())
    normalized_model_ids = [str(model_id).strip() for model_id in model_ids if str(model_id).strip()]
    group_id = _new_operation_group_id(action)
    group = {
        "id": group_id,
        "resource_type": "robotick_launcher_operation_group",
        "action": action,
        "workspace_root": normalized_workspace_root,
        "project_id": project_id,
        "model_ids": normalized_model_ids,
        "phase": "accepted",
        "created_at": now,
        "updated_at": now,
        "creator": dict(creator or {}),
        "target_policy": target_policy,
        "operation_ids": [],
    }
    operations: list[dict[str, Any]] = []
    for model_id in normalized_model_ids:
        operation_id = _new_operation_request_id(action)
        operation = {
            "id": operation_id,
            "resource_type": "robotick_launcher_model_operation",
            "group_id": group_id,
            "action": action,
            "workspace_root": normalized_workspace_root,
            "project_id": project_id,
            "model_id": model_id,
            "phase": "accepted",
            "created_at": now,
            "updated_at": now,
            "creator": dict(creator or {}),
            "target_policy": target_policy,
            "pid": None,
            "command": None,
            "log_path": None,
            "session_id": None,
            "result": None,
            "blockers": [],
        }
        operations.append(operation)
        group["operation_ids"].append(operation_id)
    with _OPERATION_LOCK:
        _OPERATION_GROUPS[group_id] = group
        for operation in operations:
            _OPERATION_RECORDS[operation["id"]] = operation
    return _operation_group_snapshot(group_id)


def _operation_group_snapshot(group_id: str) -> dict[str, Any]:
    with _OPERATION_LOCK:
        group = _OPERATION_GROUPS.get(group_id)
        if group is None:
            return {}
        operations = [
            dict(_OPERATION_RECORDS[operation_id])
            for operation_id in group.get("operation_ids", [])
            if operation_id in _OPERATION_RECORDS
        ]
        snapshot = dict(group)
    snapshot["operations"] = operations
    return snapshot


def _operation_response_payload(group_id: str | None) -> dict[str, Any]:
    if not group_id:
        return {"operation_group": None, "operations": []}
    group = _operation_group_snapshot(group_id)
    return {
        "operation_group": group or None,
        "operations": list(group.get("operations") or []) if group else [],
    }


def _set_operation_group_phase(group_id: str | None, phase: str) -> None:
    if not group_id:
        return
    now = _utc_now().isoformat()
    with _OPERATION_LOCK:
        group = _OPERATION_GROUPS.get(group_id)
        if group is None:
            return
        current_phase = str(group.get("phase") or "")
        if current_phase in _TERMINAL_OPERATION_PHASES and phase not in _TERMINAL_OPERATION_PHASES:
            return
        group["phase"] = phase
        group["updated_at"] = now


def _set_operation_phase(
    operation_id: str,
    phase: str,
    *,
    result: dict[str, Any] | None = None,
    blockers: list[dict[str, Any]] | None = None,
    pid: int | None = None,
    command: list[str] | None = None,
    log_path: str | None = None,
    session_id: str | None = None,
) -> None:
    now = _utc_now().isoformat()
    with _OPERATION_LOCK:
        operation = _OPERATION_RECORDS.get(operation_id)
        if operation is None:
            return
        current_phase = str(operation.get("phase") or "")
        if current_phase in _TERMINAL_OPERATION_PHASES and phase not in _TERMINAL_OPERATION_PHASES:
            return
        operation["phase"] = phase
        operation["updated_at"] = now
        if result is not None:
            operation["result"] = result
        if blockers is not None:
            operation["blockers"] = blockers
        if pid is not None:
            operation["pid"] = pid
        if command is not None:
            operation["command"] = command
        if log_path is not None:
            operation["log_path"] = log_path
        if session_id is not None:
            operation["session_id"] = session_id
        group_id = str(operation.get("group_id") or "")
        group = _OPERATION_GROUPS.get(group_id)
        if group is not None:
            group["updated_at"] = now


def _operation_id_for_model(group_id: str | None, model_id: str) -> str | None:
    if not group_id:
        return None
    normalized_model_id = str(model_id or "").strip()
    with _OPERATION_LOCK:
        group = _OPERATION_GROUPS.get(group_id)
        if group is None:
            return None
        for operation_id in group.get("operation_ids", []):
            operation = _OPERATION_RECORDS.get(operation_id)
            if operation is not None and operation.get("model_id") == normalized_model_id:
                return str(operation_id)
    return None


def _set_operation_phase_for_model(
    group_id: str | None,
    model_id: str,
    phase: str,
    **kwargs: Any,
) -> None:
    operation_id = _operation_id_for_model(group_id, model_id)
    if operation_id:
        _set_operation_phase(operation_id, phase, **kwargs)


def _set_group_operations_phase(group_id: str | None, phase: str) -> None:
    if not group_id:
        return
    with _OPERATION_LOCK:
        operation_ids = list((_OPERATION_GROUPS.get(group_id) or {}).get("operation_ids", []))
    _set_operation_group_phase(group_id, phase)
    for operation_id in operation_ids:
        _set_operation_phase(operation_id, phase)


def _refresh_operation_group_phase(group_id: str | None) -> None:
    if not group_id:
        return
    now = _utc_now().isoformat()
    with _OPERATION_LOCK:
        group = _OPERATION_GROUPS.get(group_id)
        if group is None:
            return
        operations = [
            _OPERATION_RECORDS[operation_id]
            for operation_id in group.get("operation_ids", [])
            if operation_id in _OPERATION_RECORDS
        ]
        if not operations:
            return
        phases = {str(operation.get("phase") or "") for operation in operations}
        if phases <= {"cancelled_by_stop", "cancelled"}:
            group["phase"] = "cancelled_by_stop"
        elif phases <= _TERMINAL_OPERATION_PHASES:
            group["phase"] = "failed" if "failed" in phases else "succeeded"
        group["updated_at"] = now


def _active_operation_model_ids(
    workspace_root: str,
    project_id: str,
    model_ids: list[str] | None = None,
) -> list[str]:
    selected = {str(model_id).strip() for model_id in (model_ids or []) if str(model_id).strip()}
    normalized_workspace_root = str(Path(workspace_root).resolve())
    active_model_ids: set[str] = set()
    with _OPERATION_LOCK:
        operations = list(_OPERATION_RECORDS.values())
    for operation in operations:
        if operation.get("workspace_root") != normalized_workspace_root:
            continue
        if operation.get("project_id") != project_id:
            continue
        model_id = str(operation.get("model_id") or "").strip()
        if not model_id:
            continue
        if selected and model_id not in selected:
            continue
        phase = str(operation.get("phase") or "")
        if phase not in _TERMINAL_OPERATION_PHASES:
            active_model_ids.add(model_id)
    return sorted(active_model_ids)


def _cancel_operations_for_models(
    *,
    workspace_root: str,
    project_id: str,
    model_ids: list[str],
    reason: str,
) -> list[dict[str, Any]]:
    selected = {str(model_id).strip() for model_id in model_ids if str(model_id).strip()}
    normalized_workspace_root = str(Path(workspace_root).resolve())
    cancelled: list[dict[str, Any]] = []
    affected_group_ids: set[str] = set()
    now = _utc_now().isoformat()
    with _OPERATION_LOCK:
        for operation in _OPERATION_RECORDS.values():
            if operation.get("workspace_root") != normalized_workspace_root:
                continue
            if operation.get("project_id") != project_id:
                continue
            model_id = str(operation.get("model_id") or "").strip()
            if selected and model_id not in selected:
                continue
            phase = str(operation.get("phase") or "")
            if phase in _TERMINAL_OPERATION_PHASES:
                continue
            operation["phase"] = "cancelled_by_stop"
            operation["updated_at"] = now
            operation["result"] = {"reason": reason}
            operation["blockers"] = []
            affected_group_ids.add(str(operation.get("group_id") or ""))
            cancelled.append(dict(operation))
    for group_id in affected_group_ids:
        _refresh_operation_group_phase(group_id)
    return cancelled


def _operation_cancelled_for_model(group_id: str | None, model_id: str) -> bool:
    operation_id = _operation_id_for_model(group_id, model_id)
    if not operation_id:
        return False
    with _OPERATION_LOCK:
        operation = _OPERATION_RECORDS.get(operation_id)
        return str((operation or {}).get("phase") or "") in {"cancelled", "cancelled_by_stop"}


def _operation_group_cancelled(group_id: str | None) -> bool:
    if not group_id:
        return False
    with _OPERATION_LOCK:
        group = _OPERATION_GROUPS.get(group_id)
        return str((group or {}).get("phase") or "") in {"cancelled", "cancelled_by_stop"}


def _operation_for_model(
    operation_id: str,
    *,
    workspace_root: str | None = None,
    project_id: str | None = None,
    model_id: str | None = None,
) -> dict[str, Any] | None:
    with _OPERATION_LOCK:
        operation = _OPERATION_RECORDS.get(operation_id)
        if operation is None:
            return None
        snapshot = dict(operation)
    if workspace_root and snapshot.get("workspace_root") != str(Path(workspace_root).resolve()):
        return None
    if project_id and snapshot.get("project_id") != project_id:
        return None
    if model_id and snapshot.get("model_id") != model_id:
        return None
    return snapshot


def _has_successful_stop_control(runtime: dict[str, Any]) -> bool:
    control = runtime.get("control")
    if not isinstance(control, dict):
        return False
    return (
        control.get("action") in {"stop", "restart-stop"}
        and control.get("returncode") == 0
        and isinstance(runtime.get("stopped_at"), str)
    )


def _has_inflight_stop_control(runtime: dict[str, Any]) -> bool:
    control = runtime.get("control")
    if not isinstance(control, dict):
        return False
    return (
        control.get("action") in {"stop", "restart-stop"}
        and control.get("returncode") is None
        and isinstance(control.get("started_at"), str)
    )


def _session_log_dir(workspace_root: str) -> Path:
    path = Path(workspace_root).resolve() / ".robotick" / "logs" / "launcher-sessions"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _build_launcher_env() -> dict[str, str]:
    env = os.environ.copy()
    entries = [str(_launcher_src_dir())]
    if env.get("PYTHONPATH"):
        entries.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(entries)
    return env


def _spawn_session_worker(
    workspace_root: str,
    project_name: str,
    project_dir: Path,
    session: Any,
    *,
    selected: bool,
) -> tuple[int | None, str | None, list[str] | None]:
    if not selected:
        return None, None, None
    python_executable = os.environ.get("ROBOTICK_HUB_PYTHON_EXECUTABLE") or sys.executable
    target_platform = str(session.target.platform or "linux")
    log_path = _session_log_dir(workspace_root) / f"{session.id}.log"
    command = [
        python_executable,
        "-m",
        _launcher_cli_module_name(),
        "run",
        project_name,
        session.model_id,
        target_platform,
        "--base-dir",
        str(project_dir),
        "--workspace-dir",
        str(Path(workspace_root).resolve()),
    ]
    with open(log_path, "a", encoding="utf-8") as log_handle:
        child = subprocess.Popen(
            command,
            cwd=project_dir,
            env=_build_launcher_env(),
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )
    return child.pid, str(log_path), command


def _pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    stat_path = Path(f"/proc/{pid}/stat")
    if stat_path.exists():
        try:
            stat_parts = stat_path.read_text(encoding="utf-8").split()
        except OSError:
            return False
        if len(stat_parts) >= 3 and stat_parts[2] == "Z":
            return False
    return True


def _signal_worker_process_group(pid: int | None) -> None:
    if not pid:
        return
    if os.name != "posix":
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            return
        deadline = time.time() + 2
        while time.time() < deadline:
            if not _pid_alive(pid):
                return
            time.sleep(0.05)
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            return
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except (AttributeError, OSError):
        return
    deadline = time.time() + 2
    while time.time() < deadline:
        if not _pid_alive(pid):
            return
        time.sleep(0.05)
    try:
        os.killpg(pid, signal.SIGKILL)
    except (AttributeError, OSError):
        return


def _stop_session_runtime(workspace_root: str, session_payload: dict[str, Any]) -> None:
    runtime_payload = dict(session_payload.get("runtime") or {})
    teardown = dict(runtime_payload.get("teardown") or {})
    teardown["executed_at"] = _utc_now().isoformat()
    teardown["executed_strategy"] = teardown.get("strategy") or "launcher-target-plan"
    teardown["control_endpoint_available"] = bool(teardown.get("control_endpoint_available"))

    worker_pid = ((session_payload.get("runtime") or {}).get("worker") or {}).get("pid")
    _signal_worker_process_group(worker_pid)

    resolve_target_plan = _launcher_target_plan_module()
    get_launcher_paths, stop_local_binary_process = _launcher_utils()

    project_id = str(session_payload.get("project_id") or "")
    model_id = str(session_payload.get("model_id") or "")
    project_path = _resolve_project_path(workspace_root, project_id)
    project_dir = project_path.parent.resolve()
    target = dict(session_payload.get("target") or {})
    platform = str(target.get("platform") or "linux")
    _, _, binary_path = get_launcher_paths(project_id, model_id, platform, project_dir)
    plan = resolve_target_plan(project_id, model_id, platform, project_dir)
    stop_handler = getattr(plan.run, "stop_handler", None)
    if stop_handler is not None:
        stop_handler(False)
        return
    if getattr(plan.run, "strategy", None) == "local":
        stop_local_binary_process(binary_path, dry_run=False)


def _refresh_state(workspace_root: str) -> None:
    domain = _launcher_domain()
    store = domain.LauncherSessionStore(workspace_root)
    groups = store.list_groups()
    for group in groups:
        sessions = store.list_sessions(group_id=group.id)
        changed = False
        updated_sessions = []
        for session in sessions:
            latest_session = store.get_session(session.id)
            if latest_session is not None:
                session = latest_session
            runtime = dict(session.runtime or {})
            worker = dict(runtime.get("worker") or {})
            pid = worker.get("pid")
            worker_alive = _pid_alive(int(pid)) if pid else False
            reconciled = _reconcile_session_runtime_state(
                workspace_root,
                session,
                worker_alive=worker_alive,
            )
            if reconciled != session:
                session = reconciled
                changed = True
                if (
                    _enum_text(getattr(session, "lifecycle", "")) in {"handed_off", "running"}
                    and str(getattr(session, "readiness", "") or "") == "ready"
                ):
                    _clear_runtime_operation(
                        workspace_root,
                        session,
                        project_path=getattr(group, "project_path", None),
                        result={
                            "action": "launch",
                            "returncode": 0,
                            "finished_at": _utc_now().isoformat(),
                        },
                    )
            updated_sessions.append(session)
        if changed:
            for session in updated_sessions:
                store.update_session(session)
            _refresh_group_record(store, domain, group)


def _watch_session(workspace_root: str, group_id: str, session_id: str, pid: int) -> None:
    def _runner() -> None:
        while _pid_alive(pid):
            time.sleep(0.2)
        _refresh_state(workspace_root)

    thread = threading.Thread(
        target=_runner,
        name=f"robotick-launcher-session-watch-{session_id}",
        daemon=True,
    )
    thread.start()


def _group_readiness(group_status: Any) -> str:
    normalized = getattr(group_status, "value", group_status)
    if str(normalized) == "running":
        return "ready"
    if str(normalized) == "failed":
        return "failed"
    if str(normalized) == "stale":
        return "stale"
    return "pending"


def _latest_sessions_by_model(domain: Any, sessions: list[Any]) -> list[Any]:
    return domain.select_latest_sessions_by_model(sessions)


def _enum_text(value: Any) -> str:
    if hasattr(value, "value"):
        value = value.value
    return str(value or "").strip().lower()


def _session_is_active(session: Any) -> bool:
    lifecycle = _enum_text(getattr(session, "lifecycle", ""))
    return lifecycle in {
        "planned",
        "starting",
        "handed_off",
        "running",
        "stopping",
    }


def _reduce_group_state(domain: Any, sessions: list[Any]) -> tuple[Any, str]:
    latest_sessions = _latest_sessions_by_model(domain, sessions)
    group_status = domain.reduce_group_status(latest_sessions)
    return group_status, _group_readiness(group_status)


def _spawn_stop_session_worker(
    workspace_root: str,
    session_id: str,
) -> tuple[subprocess.Popen[Any], str, list[str]]:
    python_executable = os.environ.get("ROBOTICK_HUB_PYTHON_EXECUTABLE") or sys.executable
    log_path = _session_log_dir(workspace_root) / f"{session_id}-stop.log"
    command = [
        python_executable,
        "-m",
        "robotick.launcher.workers.hub_launcher_worker",
        "stop-session",
        "--workspace-root",
        str(Path(workspace_root).resolve()),
        "--session-id",
        session_id,
    ]
    with open(log_path, "a", encoding="utf-8") as log_handle:
        child = subprocess.Popen(
            command,
            cwd=Path(workspace_root).resolve(),
            env=_build_launcher_env(),
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )
    return child, str(log_path), command


def _refresh_group_record(store: Any, domain: Any, group: Any) -> Any:
    sessions = store.list_sessions(group_id=group.id)
    group_status, readiness = _reduce_group_state(domain, sessions)
    last_confirmed_at = None
    confirmed_candidates = [session.last_confirmed_at for session in sessions if session.last_confirmed_at is not None]
    if confirmed_candidates:
        last_confirmed_at = max(confirmed_candidates)
    refreshed_group = group.model_copy(
        update={
            "status": group_status,
            "readiness": readiness,
            "updated_at": _utc_now(),
            "session_ids": [session.id for session in sessions],
            "last_confirmed_at": last_confirmed_at,
        }
    )
    store.update_group(refreshed_group)
    return refreshed_group


def _split_csv_values(value: str | None) -> list[str]:
    if value is None:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _payload_dict(payload: Any) -> dict[str, Any]:
    if hasattr(payload, "model_dump"):
        return payload.model_dump(mode="json")
    if isinstance(payload, dict):
        return dict(payload)
    return {}


def _normalize_freshness(*, readiness: Any = None, lifecycle: Any = None, status: Any = None) -> str:
    readiness_value = str(readiness or "").strip().lower()
    lifecycle_value = str(lifecycle or status or "").strip().lower()
    if readiness_value == "stale" or lifecycle_value == "stale":
        return "stale"
    if readiness_value == "failed" or lifecycle_value == "failed":
        return "failed"
    if readiness_value == "ready" or lifecycle_value in {"running", "handed_off"}:
        return "live"
    return "pending"


def _diagnostic_payloads(diagnostics: Any) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for diagnostic in diagnostics or []:
        payload = _payload_dict(diagnostic)
        if payload.get("code") or payload.get("message"):
            payloads.append(payload)
    return payloads


def _runtime_log_refs(runtime: dict[str, Any]) -> list[dict[str, str]]:
    worker = dict(runtime.get("worker") or {})
    control = dict(runtime.get("control") or {})
    probe = dict(runtime.get("probe") or {})
    log_refs: list[dict[str, str]] = []
    if worker.get("log_path"):
        log_refs.append({"kind": "worker", "path": worker["log_path"]})
    if control.get("log_path"):
        log_refs.append({"kind": "control", "path": control["log_path"]})
    if probe.get("telemetry_url"):
        log_refs.append({"kind": "runtime-telemetry", "path": probe["telemetry_url"]})
    for health_url in probe.get("health_urls") or []:
        if health_url:
            log_refs.append({"kind": "runtime-health", "path": health_url})
    return log_refs


def _latest_session_payloads_by_model(sessions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest_by_model: dict[str, dict[str, Any]] = {}
    for raw_session in sessions:
        session = _payload_dict(raw_session)
        model_id = str(session.get("model_id") or "")
        if not model_id:
            continue
        current = latest_by_model.get(model_id)
        generation = int(session.get("generation") or 0)
        if current is None or generation > int(current.get("generation") or 0):
            latest_by_model[model_id] = session
            continue
        if generation == int(current.get("generation") or 0):
            current_updated_at = str(current.get("updated_at") or current.get("created_at") or "")
            candidate_updated_at = str(session.get("updated_at") or session.get("created_at") or "")
            if candidate_updated_at > current_updated_at:
                latest_by_model[model_id] = session
    return list(latest_by_model.values())


def _actionable_group_diagnostics(
    group_payload: dict[str, Any],
    related_sessions: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    group_diagnostics = _diagnostic_payloads(group_payload.get("diagnostics"))
    if group_diagnostics:
        return group_diagnostics
    session_diagnostics: list[dict[str, Any]] = []
    normalized_sessions = [_payload_dict(session) for session in related_sessions or []]
    for session_payload in _latest_session_payloads_by_model(normalized_sessions):
        for diagnostic in _diagnostic_payloads(session_payload.get("diagnostics")):
            details = dict(diagnostic.get("details") or {})
            details.setdefault("session_id", session_payload.get("id"))
            details.setdefault("model_id", session_payload.get("model_id"))
            session_diagnostics.append({**diagnostic, "details": details})
    return session_diagnostics


def _default_stage_policy() -> dict[str, Any]:
    return {"kind": "default", "stages": []}


def _session_stage_policy(
    session_payload: dict[str, Any],
    group_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if group_payload is not None:
        intent = dict(group_payload.get("intent") or {})
        stage_policy = dict(intent.get("stage_policy") or {})
        if stage_policy:
            return {
                "kind": stage_policy.get("kind") or "default",
                "stages": list(stage_policy.get("stages") or []),
            }
    target = dict(session_payload.get("target") or {})
    target_stages = list(target.get("stages") or [])
    if target_stages:
        return {"kind": "explicit", "stages": target_stages}
    return _default_stage_policy()


def _enrich_group_payload(
    group_payload: dict[str, Any],
    *,
    related_sessions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    intent = dict(group_payload.get("intent") or {})
    scope = dict(intent.get("scope") or {})
    stage_policy = dict(intent.get("stage_policy") or {})
    creator = dict(group_payload.get("created_by") or intent.get("created_by") or {})
    return {
        **group_payload,
        "creator": creator,
        "resolved_scope": {
            "kind": scope.get("kind"),
            "value": scope.get("value"),
            "resolved_model_ids": list(group_payload.get("resolved_model_ids") or []),
        },
        "target_policy": intent.get("target_policy"),
        "stage_policy": {
            "kind": stage_policy.get("kind") or "default",
            "stages": list(stage_policy.get("stages") or []),
        },
        "freshness": _normalize_freshness(
            readiness=group_payload.get("readiness"),
            status=group_payload.get("status"),
        ),
        "actionable_diagnostics": _actionable_group_diagnostics(group_payload, related_sessions),
    }


def _enrich_session_payload(
    session_payload: dict[str, Any],
    *,
    group_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    runtime = dict(session_payload.get("runtime") or {})
    group_intent = dict((group_payload or {}).get("intent") or {})
    return {
        **session_payload,
        "creator": dict(session_payload.get("created_by") or {}),
        "target_policy": group_intent.get("target_policy"),
        "stage_policy": _session_stage_policy(session_payload, group_payload),
        "freshness": _normalize_freshness(
            readiness=session_payload.get("readiness"),
            lifecycle=session_payload.get("lifecycle"),
        ),
        "actionable_diagnostics": _diagnostic_payloads(session_payload.get("diagnostics")),
        "log_refs": _runtime_log_refs(runtime),
    }


def _group_session_map(groups: list[dict[str, Any]], sessions: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    group_ids = {str(group.get("id") or "") for group in groups}
    mapping: dict[str, list[dict[str, Any]]] = {group_id: [] for group_id in group_ids if group_id}
    for session in sessions:
        group_id = str(session.get("group_id") or "")
        if group_id in mapping:
            mapping[group_id].append(session)
    return mapping


def _enrich_groups_and_sessions(
    groups: list[dict[str, Any]],
    sessions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sessions_by_group = _group_session_map(groups, sessions)
    group_index = {str(group.get("id") or ""): group for group in groups}
    enriched_groups = [
        _enrich_group_payload(group, related_sessions=sessions_by_group.get(str(group.get("id") or ""), []))
        for group in groups
    ]
    enriched_sessions = [
        _enrich_session_payload(session, group_payload=group_index.get(str(session.get("group_id") or "")))
        for session in sessions
    ]
    return enriched_groups, enriched_sessions


def _upsert_diagnostic(session: Any, diagnostic: Any) -> list[Any]:
    diagnostics = [item for item in session.diagnostics if item.code != diagnostic.code]
    diagnostics.append(diagnostic)
    return diagnostics


def _remove_diagnostic_codes(session: Any, *codes: str) -> list[Any]:
    blocked = set(codes)
    return [item for item in session.diagnostics if item.code not in blocked]


def _session_probe_metadata(
    workspace_root: str,
    project_name: str,
    project_dir: Path,
    session: Any,
) -> dict[str, Any]:
    Config = _launcher_config_class()
    try:
        config = Config(
            project_name,
            session.model_id,
            str(session.target.platform or "linux"),
            project_dir,
            dry_run=False,
            stub_install=False,
        )
    except Exception:
        return {}

    telemetry = dict(config.model.get("telemetry") or {})
    port = telemetry.get("port")
    if not isinstance(port, int) or port <= 0:
        return {
            "probe": {
                "authority": "launcher-worker",
                "configured": False,
                "reason": "telemetry_port_unconfigured",
            },
            "teardown": {
                "strategy": "launcher-target-plan",
                "control_endpoint_available": False,
            },
        }

    runtime = dict(config.model.get("runtime") or {})
    host = str(session.target.host or runtime.get("preferred_host") or "localhost").strip() or "localhost"
    base_url = f"http://{host}:{port}"
    return {
        "probe": {
            "authority": "robotick-engine",
            "configured": True,
            "host": host,
            "port": port,
            "telemetry_url": f"{base_url}/api/telemetry",
            "health_urls": [
                f"{base_url}/api/telemetry/health",
                f"{base_url}/health",
            ],
        },
        "teardown": {
            "strategy": "launcher-target-plan",
            "control_endpoint_available": False,
            "health_urls": [
                f"{base_url}/api/telemetry/health",
                f"{base_url}/health",
            ],
        },
    }


def _probe_runtime_authority(session: Any, *, timeout: float = 0.25) -> dict[str, Any]:
    runtime = dict(session.runtime or {})
    probe = dict(runtime.get("probe") or {})
    health_urls = [str(url).strip() for url in probe.get("health_urls") or [] if str(url).strip()]
    if not probe.get("configured") or not health_urls:
        return {
            "configured": False,
            "healthy": False,
            "health_url": None,
            "error": "runtime_probe_unconfigured",
            "authority": probe.get("authority"),
        }

    for url in health_urls:
        try:
            with urlopen(url, timeout=timeout) as response:
                if response.status == 200:
                    return {
                        "configured": True,
                        "healthy": True,
                        "health_url": url,
                        "error": None,
                        "authority": probe.get("authority") or "robotick-engine",
                    }
        except HTTPError as error:
            return {
                "configured": True,
                "healthy": False,
                "health_url": url,
                "error": f"{error.code} {error.reason}",
                "authority": probe.get("authority") or "robotick-engine",
            }
        except (OSError, URLError) as error:
            last_error = error.reason if isinstance(error, URLError) and error.reason else error
            message = str(last_error).strip() or error.__class__.__name__
            continue
    return {
        "configured": True,
        "healthy": False,
        "health_url": health_urls[0],
        "error": message if 'message' in locals() else "runtime_probe_failed",
        "authority": probe.get("authority") or "robotick-engine",
    }


def _probe_runtime_phonebook_record(record: dict[str, Any], *, timeout: float = 0.25) -> dict[str, Any]:
    health_urls = [str(url).strip() for url in record.get("health_urls") or [] if str(url).strip()]
    if not health_urls:
        health_url = str(record.get("health_url") or "").strip()
        if health_url:
            health_urls.append(health_url)
    if not health_urls:
        return {
            "configured": False,
            "healthy": False,
            "health_url": None,
            "error": "runtime_probe_unconfigured",
        }

    message = "runtime_probe_failed"
    for url in health_urls:
        try:
            with urlopen(url, timeout=timeout) as response:
                if response.status == 200:
                    return {
                        "configured": True,
                        "healthy": True,
                        "health_url": url,
                        "error": None,
                    }
        except HTTPError as error:
            return {
                "configured": True,
                "healthy": False,
                "health_url": url,
                "error": f"{error.code} {error.reason}",
            }
        except (OSError, URLError) as error:
            last_error = error.reason if isinstance(error, URLError) and error.reason else error
            message = str(last_error).strip() or error.__class__.__name__
            continue
    return {
        "configured": True,
        "healthy": False,
        "health_url": health_urls[0],
        "error": message,
    }


def _operation_in_flight(record: dict[str, Any]) -> dict[str, Any] | None:
    operation = record.get("operation")
    if not isinstance(operation, dict):
        return None
    action = str(operation.get("action") or "").strip()
    if not action:
        return None
    pid = operation.get("pid")
    pid_alive = _pid_alive(int(pid)) if isinstance(pid, int) or str(pid).isdigit() else False
    if not pid_alive and pid:
        return None
    if not pid and not _operation_is_recent(operation):
        return None
    return {
        **operation,
        "action": action,
        "pid_alive": pid_alive,
        "queued": not bool(pid),
    }


def _operation_is_recent(operation: dict[str, Any]) -> bool:
    started_at = str(operation.get("started_at") or "").strip()
    if not started_at:
        return False
    try:
        parsed = datetime.fromisoformat(started_at)
    except ValueError:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    age_seconds = (_utc_now() - parsed).total_seconds()
    return 0 <= age_seconds <= OPERATION_QUEUED_GRACE_SECONDS


def _runtime_live_projection(record: dict[str, Any]) -> dict[str, Any]:
    now = _utc_now().isoformat()
    operation = _operation_in_flight(record)
    probe = _probe_runtime_phonebook_record(record)
    pid = record.get("pid")
    pid_alive = _pid_alive(int(pid)) if isinstance(pid, int) or str(pid).isdigit() else False
    if operation is not None and operation["action"] == "launching" and probe.get("healthy"):
        operation = None

    lifecycle = "stopped"
    readiness = "pending"
    freshness = "stopped"
    control_available = False

    if operation is not None and operation["action"] in {"stopping", "restarting"}:
        lifecycle = "stopping"
        freshness = "pending"
        control_available = False
    elif probe.get("healthy"):
        lifecycle = "running"
        readiness = "ready"
        freshness = "live"
        control_available = True
    elif operation is not None and operation["action"] == "launching":
        lifecycle = "starting"
        freshness = "pending"
        control_available = True
    elif pid_alive:
        lifecycle = "running"
        readiness = "failed"
        freshness = "failed"
        control_available = True

    return {
        "resource_type": "robotick_launcher_model_runtime_status",
        "id": record.get("id"),
        "project_id": record.get("project_id"),
        "project_path": record.get("project_path"),
        "model_id": record.get("model_id"),
        "lifecycle": lifecycle,
        "readiness": readiness,
        "freshness": freshness,
        "operation": operation,
        "control_available": control_available,
        "pid": pid,
        "pid_alive": pid_alive,
        "telemetry_host": record.get("telemetry_host"),
        "telemetry_port": record.get("telemetry_port"),
        "telemetry_url": record.get("telemetry_url"),
        "health_url": probe.get("health_url"),
        "health": {
            "configured": probe.get("configured"),
            "healthy": probe.get("healthy"),
            "error": probe.get("error"),
            "checked_at": now,
        },
        "log_path": record.get("log_path"),
        "updated_at": record.get("updated_at"),
    }


def _launcher_runtime_projection(
    workspace_root: str,
    *,
    project_id: str | None = None,
    model_ids: list[str] | None = None,
) -> dict[str, Any]:
    records = _list_runtime_phonebook_records(
        workspace_root,
        project_id=project_id,
        model_ids=model_ids,
    )
    records = [
        _hydrate_runtime_phonebook_record_from_session(workspace_root, record)
        for record in records
    ]
    models = [_runtime_live_projection(record) for record in records]
    if not models:
        state = "stopped"
    elif any(model["lifecycle"] in {"starting", "stopping"} for model in models):
        state = "pending"
    elif any(model["freshness"] == "failed" for model in models):
        state = "degraded"
    elif any(model["freshness"] == "live" for model in models):
        state = "running"
    else:
        state = "stopped"
    return {
        "resource_type": "robotick_launcher_runtime_status",
        "state": state,
        "models": models,
    }


def _runtime_model_blocks_launch(model: dict[str, Any]) -> bool:
    lifecycle = str(model.get("lifecycle") or "").strip()
    freshness = str(model.get("freshness") or "").strip()
    return lifecycle in {"starting", "running", "stopping"} or freshness in {"live", "failed"}


def _resolve_launch_request(
    workspace_root: str,
    request: LauncherModelLaunchRequest,
    *,
    project_path: Path | None = None,
) -> tuple[Path, Any, Any]:
    domain = _launcher_domain()
    project_path = project_path or _resolve_project_path(workspace_root, request.project_name)
    if request.profile:
        intent = domain.launch_intent_from_profile(request.project_name, project_path, request.profile)
    else:
        intent = domain.LaunchIntent.model_validate(request.intent or {})
    if request.creator:
        intent = intent.model_copy(update={"created_by": domain.CreatorMetadata.model_validate(request.creator)})
    return project_path, intent, domain.expand_launch_intent(project_path, intent)


def _model_intent_from_resolved_model(domain: Any, resolved: Any, model: Any) -> Any:
    return resolved.intent.model_copy(
        update={
            "scope": domain.LaunchScope(kind=domain.ScopeKind.MODEL, value=model.model_id),
            "target_overrides": {
                model.model_id: domain.TargetOverride(
                    platform=model.target_platform,
                    variant=model.target_variant,
                    host=model.preferred_host,
                    stages=model.stages,
                )
            },
        }
    )


def _finalize_launch_runtime_metadata(
    workspace_root: str,
    project_name: str,
    project_path: Path,
    launch_entries: list[dict[str, Any]],
    *,
    operation_id: str | None = None,
) -> list[Any]:
    store = _json_store(workspace_root)
    project_dir = project_path.parent.resolve()
    finalized: list[Any] = []
    for entry in launch_entries:
        session = entry["session"]
        latest_session = store.get_session(session.id)
        if latest_session is not None:
            session = latest_session
        runtime_metadata = _session_probe_metadata(
            workspace_root,
            project_name,
            project_dir,
            session,
        )
        runtime = {
            **dict(session.runtime or {}),
            **runtime_metadata,
        }
        session = session.model_copy(
            update={
                "runtime": runtime,
                "updated_at": _utc_now(),
            }
        )
        store.update_session(session)
        _set_runtime_operation(
            workspace_root,
            session,
            project_path=str(project_path),
            action="launching",
            pid=(dict(runtime.get("worker") or {}).get("pid")),
            command=(dict(runtime.get("worker") or {}).get("command")),
            log_path=(dict(runtime.get("worker") or {}).get("log_path")),
            request_id=operation_id,
        )
        _set_operation_phase_for_model(
            operation_id,
            session.model_id,
            "succeeded" if dict(runtime.get("worker") or {}).get("pid") else "failed",
            pid=(dict(runtime.get("worker") or {}).get("pid")),
            command=(dict(runtime.get("worker") or {}).get("command")),
            log_path=(dict(runtime.get("worker") or {}).get("log_path")),
            session_id=session.id,
        )
        entry["session"] = session
        finalized.append(session)
    _set_operation_group_phase(operation_id, "succeeded")
    return finalized


def _finalize_launch_runtime_metadata_async(
    workspace_root: str,
    project_name: str,
    project_path: Path,
    launch_entries: list[dict[str, Any]],
    *,
    operation_id: str | None = None,
) -> None:
    thread = threading.Thread(
        target=_finalize_launch_runtime_metadata,
        args=(workspace_root, project_name, project_path, launch_entries),
        kwargs={"operation_id": operation_id},
        name=f"robotick-launcher-launch-metadata-{project_name}",
        daemon=True,
    )
    thread.start()


def _launch_resolved_models(
    workspace_root: str,
    project_name: str,
    project_path: Path,
    resolved: Any,
    *,
    clear_logs: bool = False,
    wait: bool = True,
    operation_id: str | None = None,
) -> dict[str, Any]:
    domain = _launcher_domain()
    store = _json_store(workspace_root)
    _set_operation_group_phase(operation_id, "queued")
    runtime_projection = _launcher_runtime_projection(workspace_root, project_id=project_name)
    runtime_active_model_ids = {
        str(model.get("model_id") or "").strip()
        for model in runtime_projection.get("models") or []
        if isinstance(model, dict)
        and _runtime_model_blocks_launch(model)
        and not (
            operation_id
            and isinstance(model.get("operation"), dict)
            and model["operation"].get("request_id") == operation_id
        )
    }
    launched: list[Any] = []
    skipped: list[dict[str, Any]] = []
    groups: list[Any] = []
    launch_entries: list[dict[str, Any]] = []
    project_dir = project_path.parent.resolve()

    for model in resolved.models:
        if _operation_cancelled_for_model(operation_id, model.model_id):
            skipped.append(
                {
                    "model_id": model.model_id,
                    "reason": "cancelled_by_stop",
                    "message": "Start operation was cancelled by stop before spawn.",
                }
            )
            continue
        if not model.selected:
            _set_operation_phase_for_model(
                operation_id,
                model.model_id,
                "cancelled",
                result={"reason": "auto_launch_disabled"},
            )
            skipped.append(
                {
                    "model_id": model.model_id,
                    "reason": "auto_launch_disabled",
                    "message": "Model resolved but was not selected for launch.",
                }
            )
            continue
        if model.model_id in runtime_active_model_ids:
            _set_operation_phase_for_model(
                operation_id,
                model.model_id,
                "succeeded",
                result={"reason": "already_running"},
            )
            skipped.append(
                {
                    "model_id": model.model_id,
                    "reason": "already_running",
                    "message": "Model already has live runtime authority.",
                }
            )
            continue

        if clear_logs:
            _clear_model_log_offsets(
                workspace_root,
                project_id=project_name,
                model_ids=[model.model_id],
            )

        intent = _model_intent_from_resolved_model(domain, resolved, model)
        group = domain.ModelSessionGroupRecord(
            workspace_id=_workspace_id(workspace_root),
            project_id=project_name,
            project_path=str(project_path),
            intent=intent,
            resolved_model_ids=[model.model_id],
            created_by=intent.created_by,
        )
        session = domain.ModelSessionRecord(
            group_id=group.id,
            project_id=project_name,
            model_id=model.model_id,
            target=domain.TargetOverride(
                platform=model.target_platform,
                variant=model.target_variant,
                host=model.preferred_host,
                stages=model.stages,
            ),
            lifecycle=domain.SessionLifecycle.STARTING,
            created_by=intent.created_by,
        )
        store.create_session(session)
        _set_operation_phase_for_model(
            operation_id,
            model.model_id,
            "queued",
            session_id=session.id,
        )
        group = group.model_copy(
            update={
                "session_ids": [session.id],
                "status": domain.GroupStatus.STARTING,
                "readiness": "pending",
            }
        )
        store.create_group(group)
        _set_runtime_operation(
            workspace_root,
            session,
            project_path=str(project_path),
            action="launching",
            pid=None,
            command=None,
            log_path=None,
            request_id=operation_id,
        )
        launched.append(session)
        groups.append(group)
        launch_entries.append(
            {
                "model": model,
                "session": session,
                "group": group,
            }
        )

    for entry in launch_entries:
        session = entry["session"]
        _set_operation_group_phase(operation_id, "spawning")
        pid, log_path, command = _spawn_session_worker(
            workspace_root,
            project_name,
            project_dir,
            session,
            selected=True,
        )
        runtime = dict(session.runtime or {})
        runtime["authority"] = "launcher-worker"
        runtime["worker"] = {
            "pid": pid,
            "command": command,
            "log_path": log_path,
            "started_at": _utc_now().isoformat(),
        }
        session = session.model_copy(
            update={
                "runtime": runtime,
                "updated_at": _utc_now(),
            }
        )
        store.update_session(session)
        _set_operation_phase_for_model(
            operation_id,
            session.model_id,
            "spawning",
            pid=pid,
            command=command,
            log_path=log_path,
            session_id=session.id,
        )
        _set_runtime_operation(
            workspace_root,
            session,
            project_path=str(project_path),
            action="launching",
            pid=pid,
            command=command,
            log_path=log_path,
            request_id=operation_id,
        )
        if pid:
            _watch_session(workspace_root, entry["group"].id, session.id, pid)
        entry["session"] = session

    if wait:
        _finalize_launch_runtime_metadata(
            workspace_root,
            project_name,
            project_path,
            launch_entries,
            operation_id=operation_id,
        )
    else:
        _finalize_launch_runtime_metadata_async(
            workspace_root,
            project_name,
            project_path,
            launch_entries,
            operation_id=operation_id,
        )

    launched = [entry["session"] for entry in launch_entries]

    enriched_groups, enriched_sessions = _enrich_groups_and_sessions(
        [group.model_dump(mode="json") for group in groups],
        [session.model_dump(mode="json") for session in launched],
    )
    return {
        "resource_type": "robotick_launcher_model_launch_result",
        "project_id": project_name,
        "launched_models": [session.model_id for session in launched],
        "skipped_models": skipped,
        "groups": enriched_groups,
        "sessions": enriched_sessions,
        "runtime": _launcher_runtime_projection(workspace_root, project_id=project_name),
    }


def _latest_runtime_sessions_for_models(
    workspace_root: str,
    *,
    project_name: str,
    model_ids: list[str],
) -> list[Any]:
    store = _json_store(workspace_root)
    model_id_set = set(model_ids)
    runtime_records = [
        record
        for record in _list_runtime_phonebook_records(workspace_root)
        if str(record.get("project_id") or "") == project_name
        and (not model_id_set or str(record.get("model_id") or "") in model_id_set)
    ]
    session_ids = [
        str(record.get("last_session_id") or "").strip()
        for record in runtime_records
        if str(record.get("last_session_id") or "").strip()
    ]
    sessions = [store.get_session(session_id) for session_id in session_ids]
    return [
        session
        for session in sessions
        if session is not None
        and session.project_id == project_name
        and (not model_ids or session.model_id in set(model_ids))
        and _session_is_active(session)
    ]


def _begin_stop_model_sessions(
    workspace_root: str,
    sessions: list[Any],
    *,
    action: str = "stop",
    operation_id: str | None = None,
) -> list[tuple[Any, Any, str, list[str]]]:
    domain = _launcher_domain()
    store = _json_store(workspace_root)
    stop_workers: list[tuple[Any, Any, str, list[str]]] = []
    pending_sessions: list[Any] = []
    for session in sessions:
        project_path = str(_resolve_project_path(workspace_root, session.project_id))
        runtime = dict(session.runtime or {})
        runtime["control"] = {
            "action": "restart-stop" if action == "restart" else "stop",
            "started_at": _utc_now().isoformat(),
        }
        updated = session.model_copy(
            update={
                "lifecycle": domain.SessionLifecycle.STOPPING,
                "updated_at": _utc_now(),
                "runtime": runtime,
            }
        )
        store.update_session(updated)
        _set_runtime_operation(
            workspace_root,
            updated,
            project_path=project_path,
            action="restarting" if action == "restart" else "stopping",
            pid=None,
            command=None,
            log_path=None,
            request_id=operation_id,
        )
        pending_sessions.append(updated)

    for session in pending_sessions:
        child, log_path, command = _spawn_stop_session_worker(workspace_root, session.id)
        project_path = str(_resolve_project_path(workspace_root, session.project_id))
        runtime = dict(session.runtime or {})
        runtime["control"] = {
            "action": "restart-stop" if action == "restart" else "stop",
            "pid": child.pid,
            "command": command,
            "log_path": log_path,
            "started_at": _utc_now().isoformat(),
        }
        store.update_session(
            session.model_copy(
                update={
                    "lifecycle": domain.SessionLifecycle.STOPPING,
                    "updated_at": _utc_now(),
                    "runtime": runtime,
                }
            )
        )
        _set_runtime_operation(
            workspace_root,
            session.model_copy(update={"runtime": runtime}),
            project_path=project_path,
            action="restarting" if action == "restart" else "stopping",
            pid=child.pid,
            command=command,
            log_path=log_path,
            request_id=operation_id,
        )
        stop_workers.append((session.model_copy(update={"runtime": runtime}), child, log_path, command))

    return stop_workers


def _finalize_stop_model_sessions(
    workspace_root: str,
    stop_workers: list[tuple[Any, Any, str, list[str]]],
    *,
    action: str = "stop",
    operation_id: str | None = None,
) -> dict[str, Any]:
    domain = _launcher_domain()
    store = _json_store(workspace_root)
    stopped = []
    failed = []
    skipped = []
    for session, child, log_path, command in stop_workers:
        returncode = child.wait()
        final_runtime = dict(session.runtime or {})
        session_operation_id = operation_id
        runtime_record = _runtime_phonebook_record(workspace_root, session.project_id, session.model_id)
        if session_operation_id is None and isinstance(runtime_record, dict):
            operation = runtime_record.get("operation")
            if isinstance(operation, dict):
                session_operation_id = operation.get("request_id")
        final_runtime["control"] = {
            "action": "restart-stop" if action == "restart" else "stop",
            "pid": child.pid,
            "command": command,
            "log_path": log_path,
            "returncode": returncode,
            "finished_at": _utc_now().isoformat(),
        }
        if returncode == 0:
            updated = session.model_copy(
                update={
                    "lifecycle": domain.SessionLifecycle.STOPPED,
                    "readiness": "pending",
                    "updated_at": _utc_now(),
                    "diagnostics": _without_diagnostics(
                        session.diagnostics,
                        STOP_SUCCESS_CLEARED_DIAGNOSTIC_CODES,
                    ),
                    "runtime": {
                        **final_runtime,
                        "stopped_at": _utc_now().isoformat(),
                    },
                }
            )
            stopped.append(updated)
        else:
            updated = session.model_copy(
                update={
                    "lifecycle": domain.SessionLifecycle.FAILED,
                    "readiness": "failed",
                    "updated_at": _utc_now(),
                    "runtime": final_runtime,
                    "diagnostics": [
                        *session.diagnostics,
                        domain.Diagnostics(
                            code="stop_worker_failed",
                            message="Launcher stop worker exited with a non-zero status.",
                            details={"returncode": returncode, "session_id": session.id},
                        ),
                    ],
                }
            )
            failed.append(updated)
        store.update_session(updated)
        project_path = str(_resolve_project_path(workspace_root, updated.project_id))
        if action == "restart" and returncode == 0:
            _set_runtime_operation(
                workspace_root,
                updated,
                project_path=project_path,
                action="restarting",
                pid=None,
                command=None,
                log_path=log_path,
                request_id=str(session_operation_id) if session_operation_id else None,
            )
        else:
            _clear_runtime_operation(
                workspace_root,
                updated,
                project_path=project_path,
                result={
                    "action": "restart-stop" if action == "restart" else "stop",
                    "returncode": returncode,
                    "finished_at": _utc_now().isoformat(),
                },
            )
        group = store.get_group(updated.group_id)
        if group is not None:
            _refresh_group_record(store, domain, group)

    return {
        "stopped": stopped,
        "failed": failed,
        "skipped": skipped,
    }


def _finalize_stop_model_sessions_async(
    workspace_root: str,
    stop_workers: list[tuple[Any, Any, str, list[str]]],
    *,
    action: str = "stop",
    operation_id: str | None = None,
) -> None:
    thread = threading.Thread(
        target=_finalize_stop_model_sessions,
        args=(workspace_root, stop_workers),
        kwargs={"action": action, "operation_id": operation_id},
        name=f"robotick-launcher-{action}-finalize",
        daemon=True,
    )
    thread.start()


def _stop_model_sessions(
    workspace_root: str,
    sessions: list[Any],
    *,
    action: str = "stop",
    wait: bool = True,
    operation_id: str | None = None,
) -> dict[str, Any]:
    stop_workers = _begin_stop_model_sessions(
        workspace_root,
        sessions,
        action=action,
        operation_id=operation_id,
    )
    if wait:
        return _finalize_stop_model_sessions(
            workspace_root,
            stop_workers,
            action=action,
            operation_id=operation_id,
        )
    _finalize_stop_model_sessions_async(
        workspace_root,
        stop_workers,
        action=action,
        operation_id=operation_id,
    )
    return {
        "stopped": [],
        "failed": [],
        "skipped": [],
        "pending": [session for session, _child, _log_path, _command in stop_workers],
    }


def _restart_models_after_stop(
    workspace_root: str,
    project_name: str,
    project_path: Path,
    resolved: Any,
    stop_workers: list[tuple[Any, Any, str, list[str]]],
    *,
    clear_logs: bool = False,
    operation_id: str | None = None,
) -> None:
    _finalize_stop_model_sessions(
        workspace_root,
        stop_workers,
        action="restart",
        operation_id=operation_id,
    )
    _launch_resolved_models(
        workspace_root,
        project_name,
        project_path,
        resolved,
        clear_logs=clear_logs,
        wait=False,
        operation_id=operation_id,
    )


def _restart_models_after_stop_async(
    workspace_root: str,
    project_name: str,
    project_path: Path,
    resolved: Any,
    stop_workers: list[tuple[Any, Any, str, list[str]]],
    *,
    clear_logs: bool = False,
    operation_id: str | None = None,
) -> None:
    thread = threading.Thread(
        target=_restart_models_after_stop,
        args=(workspace_root, project_name, project_path, resolved, stop_workers),
        kwargs={"clear_logs": clear_logs, "operation_id": operation_id},
        name=f"robotick-launcher-restart-{project_name}",
        daemon=True,
    )
    thread.start()


def _launch_request_after_resolve(
    workspace_root: str,
    request: LauncherModelLaunchRequest,
    project_path: Path,
    operation_id: str,
) -> None:
    _set_group_operations_phase(operation_id, "resolving")
    _project_path, _intent, resolved = _resolve_launch_request(
        workspace_root,
        request,
        project_path=project_path,
    )
    if _operation_group_cancelled(operation_id):
        return
    _set_group_operations_phase(operation_id, "queued")
    _launch_resolved_models(
        workspace_root,
        request.project_name,
        project_path,
        resolved,
        clear_logs=request.clear_logs,
        wait=False,
        operation_id=operation_id,
    )


def _launch_request_after_resolve_async(
    workspace_root: str,
    request: LauncherModelLaunchRequest,
    project_path: Path,
    operation_id: str,
) -> None:
    thread = threading.Thread(
        target=_launch_request_after_resolve,
        args=(workspace_root, request, project_path, operation_id),
        name=f"robotick-launcher-launch-{request.project_name}",
        daemon=True,
    )
    thread.start()


def _launch_request_from_control(request: LauncherModelControlRequest) -> LauncherModelLaunchRequest:
    intent = request.intent
    profile = request.profile
    if profile:
        intent = None
    elif intent is None:
        intent = {
            "project": request.project_name,
            "scope": (
                {"kind": "ALL", "value": "ALL"}
                if not request.model_ids
                else {"kind": "models", "value": request.model_ids}
            ),
            "target_policy": "native",
        }
    return LauncherModelLaunchRequest(
        project_name=request.project_name,
        profile=profile,
        intent=intent,
        creator=request.creator,
        clear_logs=request.clear_logs,
    )


def _restart_request_after_resolve(
    workspace_root: str,
    request: LauncherModelControlRequest,
    project_path: Path,
    stop_workers: list[tuple[Any, Any, str, list[str]]],
    operation_id: str,
) -> None:
    launch_request = _launch_request_from_control(request)
    _project_path, _intent, resolved = _resolve_launch_request(
        workspace_root,
        launch_request,
        project_path=project_path,
    )
    _restart_models_after_stop(
        workspace_root,
        request.project_name,
        project_path,
        resolved,
        stop_workers,
        clear_logs=request.clear_logs,
        operation_id=operation_id,
    )


def _restart_request_after_resolve_async(
    workspace_root: str,
    request: LauncherModelControlRequest,
    project_path: Path,
    stop_workers: list[tuple[Any, Any, str, list[str]]],
    operation_id: str,
) -> None:
    thread = threading.Thread(
        target=_restart_request_after_resolve,
        args=(workspace_root, request, project_path, stop_workers, operation_id),
        name=f"robotick-launcher-restart-{request.project_name}",
        daemon=True,
    )
    thread.start()


def _reconcile_session_runtime_state(
    workspace_root: str,
    session: Any,
    *,
    worker_alive: bool,
) -> Any:
    domain = _launcher_domain()
    now = _utc_now()
    runtime = dict(session.runtime or {})
    worker = dict(runtime.get("worker") or {})

    if session.lifecycle == domain.SessionLifecycle.STOPPED or _has_successful_stop_control(runtime):
        diagnostics = _without_diagnostics(
            session.diagnostics,
            STOP_SUCCESS_CLEARED_DIAGNOSTIC_CODES,
        )
        if (
            session.lifecycle != domain.SessionLifecycle.STOPPED
            or session.readiness != "pending"
            or diagnostics != session.diagnostics
        ):
            return session.model_copy(
                update={
                    "lifecycle": domain.SessionLifecycle.STOPPED,
                    "readiness": "pending",
                    "updated_at": now,
                    "diagnostics": diagnostics,
                }
            )
        return session

    if session.lifecycle == domain.SessionLifecycle.STOPPING and _has_inflight_stop_control(runtime):
        return session

    probe_result = _probe_runtime_authority(session)
    observation = dict(runtime.get("observation") or {})
    observation["last_checked_at"] = now.isoformat()

    if probe_result.get("configured"):
        observation["configured_authority"] = probe_result.get("authority") or "robotick-engine"
        observation["health_url"] = probe_result.get("health_url")

    if probe_result.get("configured") and probe_result.get("healthy"):
        observation["source_of_truth"] = "runtime-authority"
        observation["last_success_at"] = now.isoformat()
        observation["last_error"] = None
        runtime["authority"] = "robotick-engine"
        runtime["health_url"] = probe_result.get("health_url")
        runtime["observation"] = observation
        updated_lifecycle = (
            domain.SessionLifecycle.HANDED_OFF
            if session.lifecycle in {domain.SessionLifecycle.PLANNED, domain.SessionLifecycle.STARTING}
            else domain.SessionLifecycle.RUNNING
        )
        diagnostics = _remove_diagnostic_codes(
            session,
            "runtime_probe_unreachable",
            "runtime_probe_stale",
            "worker_exited_without_runtime_handoff",
        )
        if not worker_alive and worker.get("pid"):
            diagnostics = _upsert_diagnostic(
                session.model_copy(update={"diagnostics": diagnostics}),
                domain.Diagnostics(
                    code="worker_exited_after_runtime_handoff",
                    message="Launcher worker exited after runtime authority was confirmed healthy.",
                    details={"worker_pid": worker.get("pid")},
                ),
            )
        else:
            diagnostics = [
                item for item in diagnostics if item.code != "worker_exited_after_runtime_handoff"
            ]
        return session.model_copy(
            update={
                "lifecycle": updated_lifecycle,
                "readiness": "ready",
                "last_confirmed_at": now,
                "updated_at": now,
                "runtime": runtime,
                "diagnostics": diagnostics,
            }
        )

    if probe_result.get("configured"):
        observation["source_of_truth"] = "last-known-runtime" if session.last_confirmed_at else "launcher-worker"
        observation["last_error"] = probe_result.get("error")
        observation["last_error_at"] = now.isoformat()
        runtime["observation"] = observation

    if session.lifecycle in {domain.SessionLifecycle.HANDED_OFF, domain.SessionLifecycle.RUNNING, domain.SessionLifecycle.STALE}:
        candidate = session.model_copy(update={"runtime": runtime})
        if domain.is_session_stale(candidate, now=now):
            diagnostics = _upsert_diagnostic(
                candidate,
                domain.Diagnostics(
                    code="runtime_probe_stale",
                    message="Runtime authority health could not be confirmed within the freshness window.",
                    details={"error": probe_result.get("error"), "health_url": probe_result.get("health_url")},
                ),
            )
            return candidate.model_copy(
                update={
                    "lifecycle": domain.SessionLifecycle.STALE,
                    "readiness": "stale",
                    "updated_at": now,
                    "runtime": runtime,
                    "diagnostics": diagnostics,
                }
            )
        return candidate.model_copy(update={"updated_at": now, "runtime": runtime})

    if worker_alive:
        if session.lifecycle == domain.SessionLifecycle.STARTING and not probe_result.get("configured"):
            runtime["authority"] = "launcher-worker"
            runtime["observation"] = observation
            return session.model_copy(
                update={
                    "lifecycle": domain.SessionLifecycle.RUNNING,
                    "readiness": "ready",
                    "last_confirmed_at": now,
                    "updated_at": now,
                    "runtime": runtime,
                    "diagnostics": _remove_diagnostic_codes(session, "runtime_probe_unreachable", "runtime_probe_stale"),
                }
            )
        runtime["authority"] = runtime.get("authority") or "launcher-worker"
        runtime["observation"] = observation
        return session.model_copy(update={"updated_at": now, "runtime": runtime})

    if session.lifecycle in {domain.SessionLifecycle.STARTING, domain.SessionLifecycle.PLANNED}:
        returncode = worker.get("returncode")
        new_lifecycle = (
            domain.SessionLifecycle.FAILED
            if isinstance(returncode, int) and returncode != 0
            else domain.SessionLifecycle.STOPPED
        )
        diagnostics = list(session.diagnostics)
        if probe_result.get("configured"):
            diagnostics = _upsert_diagnostic(
                session.model_copy(update={"diagnostics": diagnostics}),
                domain.Diagnostics(
                    code="worker_exited_without_runtime_handoff",
                    message="Launcher worker exited before runtime authority could be confirmed healthy.",
                    details={
                        "returncode": returncode,
                        "error": probe_result.get("error"),
                        "health_url": probe_result.get("health_url"),
                    },
                ),
            )
        runtime["authority"] = runtime.get("authority") or "launcher-worker"
        runtime["observation"] = observation
        return session.model_copy(
            update={
                "lifecycle": new_lifecycle,
                "updated_at": now,
                "readiness": "failed" if new_lifecycle == domain.SessionLifecycle.FAILED else "pending",
                "runtime": runtime,
                "diagnostics": diagnostics,
            }
        )

    return session.model_copy(update={"updated_at": now, "runtime": runtime})


class LauncherAbility:
    manifest = AbilityManifest(
        name="launcher",
        version="0.1.0",
        owner="robotick-launcher",
        description="In-process launcher ability with group/session resources.",
        plugin_shaped=True,
    )

    def build_router(self, context_provider: Callable[[], HubContext]) -> APIRouter:
        router = APIRouter()

        @router.get("/query/get-workloads-registry", response_class=JSONResponse)
        def query_get_workloads_registry(
            project_path: str = Query(..., description="Absolute path to the project YAML file"),
            target: str = Query("linux", description="Target platform used for workload discovery"),
        ) -> JSONResponse:
            context = context_provider()
            registered = Path(project_path).resolve()
            if str(registered) not in {str(Path(path).resolve()) for path in list_workspace_project_paths(context.workspace_root)}:
                raise HTTPException(status_code=404, detail=f"Project file is not registered in this workspace: {registered}")
            query = _launcher_query()
            try:
                payload = query.build_workloads_registry(registered, target)
            except FileNotFoundError as error:
                raise HTTPException(status_code=404, detail=str(error)) from error
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            except RuntimeError as error:
                raise HTTPException(status_code=500, detail=str(error)) from error
            return JSONResponse(payload)

        @router.get("/query/get-core-model-schema", response_class=JSONResponse)
        def query_get_core_model_schema(
            project_path: str = Query(..., description="Absolute path to the project YAML file"),
            target: str = Query("linux", description="Target platform used for schema resolution"),
        ) -> JSONResponse:
            context = context_provider()
            registered = Path(project_path).resolve()
            if str(registered) not in {str(Path(path).resolve()) for path in list_workspace_project_paths(context.workspace_root)}:
                raise HTTPException(status_code=404, detail=f"Project file is not registered in this workspace: {registered}")
            query = _launcher_query()
            try:
                payload = query.get_core_model_schema(registered, target)
            except FileNotFoundError as error:
                raise HTTPException(status_code=404, detail=str(error)) from error
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            return JSONResponse(payload)

        @router.get("/v1/launcher/status", response_class=JSONResponse)
        def launcher_status() -> JSONResponse:
            context = context_provider()
            ability_status = self.get_status(context)
            return JSONResponse(
                {
                    "resource_type": "robotick_launcher_status",
                    "ability": ability_status.model_dump(),
                    "runtime": _launcher_runtime_projection(context.workspace_root),
                }
            )

        @router.get("/v1/launcher/runtime", response_class=JSONResponse)
        def launcher_runtime_status(
            project_id: str | None = None,
            model_ids: str | None = Query(None, description="Comma-separated model ids"),
        ) -> JSONResponse:
            context = context_provider()
            return JSONResponse(
                _launcher_runtime_projection(
                    context.workspace_root,
                    project_id=project_id,
                    model_ids=_split_csv_values(model_ids),
                )
            )

        @router.get("/v1/launcher/operation-groups/{group_id}", response_class=JSONResponse)
        def launcher_operation_group(group_id: str) -> JSONResponse:
            context = context_provider()
            group = _operation_group_snapshot(group_id)
            if not group or group.get("workspace_root") != str(Path(context.workspace_root).resolve()):
                raise HTTPException(status_code=404, detail=f"Launcher operation group not found: {group_id}")
            return JSONResponse(group)

        @router.get("/v1/launcher/models/{model_id}/operations/{operation_id}", response_class=JSONResponse)
        def launcher_model_operation(
            model_id: str,
            operation_id: str,
            project_id: str | None = Query(None, description="Optional project id/name"),
        ) -> JSONResponse:
            context = context_provider()
            operation = _operation_for_model(
                operation_id,
                workspace_root=context.workspace_root,
                project_id=project_id,
                model_id=model_id,
            )
            if operation is None:
                raise HTTPException(status_code=404, detail=f"Launcher model operation not found: {operation_id}")
            return JSONResponse(operation)

        def _launcher_models_start(
            request: LauncherModelLaunchRequest,
            *,
            route_action: str,
        ) -> JSONResponse:
            context = context_provider()
            project_path = _resolve_project_path(context.workspace_root, request.project_name)
            provisional_model_ids = _provisional_launch_model_ids(
                context.workspace_root,
                request.project_name,
                request,
            )
            operation_group = _create_operation_group(
                workspace_root=context.workspace_root,
                action=route_action,
                project_id=request.project_name,
                model_ids=provisional_model_ids,
                creator=request.creator,
                target_policy=_request_target_policy(request),
            )
            operation_id = str(operation_group.get("id") or _new_operation_request_id(route_action))
            if not request.wait:
                operation_payload = _operation_response_payload(operation_id)
                runtime_payload = _launcher_runtime_projection(context.workspace_root, project_id=request.project_name)
                _launch_request_after_resolve_async(
                    context.workspace_root,
                    request,
                    project_path,
                    operation_id,
                )
                return JSONResponse(
                    {
                        "resource_type": f"robotick_launcher_model_{route_action}_result",
                        "project_id": request.project_name,
                        "launched_models": [],
                        "pending_models": provisional_model_ids,
                        "skipped_models": [],
                        "groups": [],
                        "sessions": [],
                        **operation_payload,
                        "runtime": runtime_payload,
                    }
                )
            _set_group_operations_phase(operation_id, "resolving")
            project_path, _intent, resolved = _resolve_launch_request(
                context.workspace_root,
                request,
                project_path=project_path,
            )
            _set_group_operations_phase(operation_id, "queued")
            result = _launch_resolved_models(
                context.workspace_root,
                request.project_name,
                project_path,
                resolved,
                clear_logs=request.clear_logs,
                wait=request.wait,
                operation_id=operation_id,
            )
            result["resource_type"] = f"robotick_launcher_model_{route_action}_result"
            result.update(_operation_response_payload(operation_id))
            return JSONResponse(result)

        @router.post("/v1/launcher/models/start", response_class=JSONResponse)
        def launcher_models_start(request: LauncherModelLaunchRequest) -> JSONResponse:
            return _launcher_models_start(request, route_action="start")

        @router.post("/v1/launcher/models/launch", response_class=JSONResponse)
        def launcher_models_launch(request: LauncherModelLaunchRequest) -> JSONResponse:
            return _launcher_models_start(request, route_action="launch")

        @router.get("/v1/launcher/models/logs", response_class=JSONResponse)
        def launcher_models_logs(
            project_id: str = Query(..., description="Project id/name"),
            model_ids: str | None = Query(None, description="Comma-separated model ids"),
            tail: int = Query(200, ge=0, le=5000),
        ) -> JSONResponse:
            context = context_provider()
            selected_model_ids = _split_csv_values(model_ids) or _all_runtime_model_ids(context.workspace_root, project_id)
            return JSONResponse(
                {
                    "resource_type": "robotick_launcher_model_logs_batch",
                    "project_id": project_id,
                    "models": [
                        _model_log_snapshot(
                            context.workspace_root,
                            project_id=project_id,
                            model_id=model_id,
                            tail=tail,
                        )
                        for model_id in selected_model_ids
                    ],
                }
            )

        @router.post("/v1/launcher/models/logs/clear", response_class=JSONResponse)
        def launcher_models_logs_clear(request: LauncherModelLogsClearRequest) -> JSONResponse:
            context = context_provider()
            model_ids = request.model_ids or _all_runtime_model_ids(context.workspace_root, request.project_id)
            return JSONResponse(
                {
                    "resource_type": "robotick_launcher_model_logs_clear_result",
                    "project_id": request.project_id,
                    "cleared_models": _clear_model_log_offsets(
                        context.workspace_root,
                        project_id=request.project_id,
                        model_ids=model_ids,
                    ),
                }
            )

        @router.websocket("/v1/launcher/models/logs/stream")
        async def launcher_models_logs_stream(
            websocket: WebSocket,
            project_id: str,
            model_ids: str | None = None,
        ) -> None:
            await websocket.accept()
            context = context_provider()
            explicit_model_ids = _split_csv_values(model_ids)
            offsets: dict[str, int] = {}
            try:
                while True:
                    selected_model_ids = explicit_model_ids or _all_runtime_model_ids(context.workspace_root, project_id)
                    for model_id in selected_model_ids:
                        record = _runtime_phonebook_record(context.workspace_root, project_id, model_id) or {}
                        clear_offsets = _log_clear_offsets(record)
                        for source in _model_log_sources(context.workspace_root, project_id=project_id, model_id=model_id):
                            path = Path(source["path"])
                            key = _source_key(source["source_kind"], path)
                            start_offset = max(offsets.get(key, 0), clear_offsets.get(key, 0))
                            lines, end_offset = _read_log_lines(path, offset=start_offset, tail=0)
                            offsets[key] = end_offset
                            for offset, line in lines:
                                await websocket.send_json(
                                    {
                                        "resource_type": "robotick_launcher_model_log_event",
                                        "project_id": project_id,
                                        "model_id": model_id,
                                        "source_kind": source["source_kind"],
                                        "path": str(path),
                                        "offset": offset,
                                        "line": line,
                                        "timestamp": _utc_now().isoformat(),
                                    }
                                )
                    await asyncio.sleep(0.25)
            except WebSocketDisconnect:
                return

        @router.get("/v1/launcher/models/{model_id}/logs", response_class=JSONResponse)
        def launcher_model_logs(
            model_id: str,
            project_id: str = Query(..., description="Project id/name"),
            tail: int = Query(200, ge=0, le=5000),
        ) -> JSONResponse:
            context = context_provider()
            return JSONResponse(
                _model_log_snapshot(
                    context.workspace_root,
                    project_id=project_id,
                    model_id=model_id,
                    tail=tail,
                )
            )

        @router.post("/v1/launcher/models/{model_id}/logs/clear", response_class=JSONResponse)
        def launcher_model_logs_clear(
            model_id: str,
            request: LauncherModelLogsClearRequest,
        ) -> JSONResponse:
            context = context_provider()
            return JSONResponse(
                {
                    "resource_type": "robotick_launcher_model_logs_clear_result",
                    "project_id": request.project_id,
                    "cleared_models": _clear_model_log_offsets(
                        context.workspace_root,
                        project_id=request.project_id,
                        model_ids=[model_id],
                    ),
                }
            )

        @router.post("/v1/launcher/models/stop", response_class=JSONResponse)
        def launcher_models_stop(request: LauncherModelControlRequest) -> JSONResponse:
            context = context_provider()
            sessions = _latest_runtime_sessions_for_models(
                context.workspace_root,
                project_name=request.project_name,
                model_ids=request.model_ids,
            )
            target_model_ids = request.model_ids or sorted(
                {
                    *[session.model_id for session in sessions],
                    *_all_runtime_model_ids(context.workspace_root, request.project_name),
                    *_active_operation_model_ids(context.workspace_root, request.project_name),
                }
            )
            cancelled_operations = _cancel_operations_for_models(
                workspace_root=context.workspace_root,
                project_id=request.project_name,
                model_ids=target_model_ids,
                reason="stop_requested",
            )
            cleared_runtime_operations = _clear_queued_runtime_operations(
                context.workspace_root,
                project_id=request.project_name,
                model_ids=target_model_ids,
                reason="stop_requested",
            )
            operation_group = _create_operation_group(
                workspace_root=context.workspace_root,
                action="stop",
                project_id=request.project_name,
                model_ids=target_model_ids,
                creator=request.creator,
            )
            operation_id = str(operation_group.get("id") or "")
            result = _stop_model_sessions(
                context.workspace_root,
                sessions,
                action="stop",
                wait=request.wait,
                operation_id=operation_id,
            )
            if request.wait:
                _set_group_operations_phase(operation_id, "failed" if result["failed"] else "succeeded")
            else:
                _set_group_operations_phase(operation_id, "stopping")
            return JSONResponse(
                {
                    "resource_type": "robotick_launcher_model_stop_result",
                    "project_id": request.project_name,
                    "stopped_models": [session.model_id for session in result["stopped"]],
                    "failed_models": [session.model_id for session in result["failed"]],
                    "pending_models": [session.model_id for session in result.get("pending", [])],
                    "skipped_models": result["skipped"],
                    "stopped_sessions": [
                        _enrich_session_payload(session.model_dump(mode="json")) for session in result["stopped"]
                    ],
                    "failed_sessions": [
                        _enrich_session_payload(session.model_dump(mode="json")) for session in result["failed"]
                    ],
                    "pending_sessions": [
                        _enrich_session_payload(session.model_dump(mode="json")) for session in result.get("pending", [])
                    ],
                    "cancelled_operations": cancelled_operations,
                    "cleared_runtime_operations": cleared_runtime_operations,
                    **_operation_response_payload(operation_id),
                    "runtime": _launcher_runtime_projection(context.workspace_root, project_id=request.project_name),
                }
            )

        @router.post("/v1/launcher/models/restart", response_class=JSONResponse)
        def launcher_models_restart(request: LauncherModelControlRequest) -> JSONResponse:
            context = context_provider()
            project_path = _resolve_project_path(context.workspace_root, request.project_name)
            launch_request = _launch_request_from_control(request)
            provisional_model_ids = _provisional_launch_model_ids(
                context.workspace_root,
                request.project_name,
                request,
            )
            operation_group = _create_operation_group(
                workspace_root=context.workspace_root,
                action="restart",
                project_id=request.project_name,
                model_ids=provisional_model_ids,
                creator=request.creator,
                target_policy=_request_target_policy(request),
            )
            operation_id = str(operation_group.get("id") or _new_operation_request_id("restart"))
            _publish_provisional_runtime_operations(
                context.workspace_root,
                project_id=request.project_name,
                project_path=project_path,
                model_ids=provisional_model_ids,
                action="restarting",
                request_id=operation_id,
                overwrite_active=True,
                clear_session_id=False,
            )
            if request.wait:
                project_path, _intent, resolved = _resolve_launch_request(
                    context.workspace_root,
                    launch_request,
                    project_path=project_path,
                )
                selected_model_ids = list(resolved.selected_model_ids)
            else:
                resolved = None
                selected_model_ids = provisional_model_ids
            sessions = _latest_runtime_sessions_for_models(
                context.workspace_root,
                project_name=request.project_name,
                model_ids=selected_model_ids,
            )
            if not request.wait:
                stop_workers = _begin_stop_model_sessions(
                    context.workspace_root,
                    sessions,
                    action="restart",
                    operation_id=operation_id,
                )
                if not stop_workers:
                    _launch_request_after_resolve_async(
                        context.workspace_root,
                        launch_request,
                        project_path,
                        operation_id,
                    )
                    return JSONResponse(
                        {
                            "resource_type": "robotick_launcher_model_restart_result",
                            "project_id": request.project_name,
                            "stopped_models": [],
                            "failed_models": [],
                            "pending_models": provisional_model_ids,
                            "launched_models": [],
                            "skipped_models": [],
                            "stopped_sessions": [],
                            "failed_sessions": [],
                            "pending_sessions": [],
                            "sessions": [],
                            "groups": [],
                            **_operation_response_payload(operation_id),
                            "runtime": _launcher_runtime_projection(context.workspace_root, project_id=request.project_name),
                        }
                    )
                _restart_request_after_resolve_async(
                    context.workspace_root,
                    request,
                    project_path,
                    stop_workers,
                    operation_id=operation_id,
                )
                pending_sessions = [
                    session for session, _child, _log_path, _command in stop_workers
                ]
                return JSONResponse(
                    {
                        "resource_type": "robotick_launcher_model_restart_result",
                        "project_id": request.project_name,
                        "stopped_models": [],
                        "failed_models": [],
                        "pending_models": [session.model_id for session in pending_sessions],
                        "launched_models": [],
                        "skipped_models": [],
                        "stopped_sessions": [],
                        "failed_sessions": [],
                        "pending_sessions": [
                            _enrich_session_payload(session.model_dump(mode="json")) for session in pending_sessions
                        ],
                        "sessions": [],
                        "groups": [],
                        **_operation_response_payload(operation_id),
                        "runtime": _launcher_runtime_projection(context.workspace_root, project_id=request.project_name),
                    }
                )

            stop_result = _stop_model_sessions(
                context.workspace_root,
                sessions,
                action="restart",
                operation_id=operation_id,
            )
            launch_result = _launch_resolved_models(
                context.workspace_root,
                request.project_name,
                project_path,
                resolved,
                clear_logs=request.clear_logs,
                wait=True,
                operation_id=operation_id,
            )
            return JSONResponse(
                {
                    "resource_type": "robotick_launcher_model_restart_result",
                    "project_id": request.project_name,
                    "stopped_models": [session.model_id for session in stop_result["stopped"]],
                    "failed_models": [session.model_id for session in stop_result["failed"]],
                    "launched_models": launch_result["launched_models"],
                    "skipped_models": [
                        *stop_result["skipped"],
                        *launch_result["skipped_models"],
                    ],
                    "stopped_sessions": [
                        _enrich_session_payload(session.model_dump(mode="json")) for session in stop_result["stopped"]
                    ],
                    "failed_sessions": [
                        _enrich_session_payload(session.model_dump(mode="json")) for session in stop_result["failed"]
                    ],
                    "sessions": launch_result["sessions"],
                    "groups": launch_result["groups"],
                    **_operation_response_payload(operation_id),
                    "runtime": _launcher_runtime_projection(context.workspace_root, project_id=request.project_name),
                }
            )

        return router

    def get_status(self, context: HubContext) -> AbilityStatus:
        runtimes = _list_runtime_phonebook_records(context.workspace_root)
        return AbilityStatus(
            name=self.manifest.name,
            version=self.manifest.version,
            status="available",
            details={
                "model_runtime_count": len(runtimes),
            },
        )
