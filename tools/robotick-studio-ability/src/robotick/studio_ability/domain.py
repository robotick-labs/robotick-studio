from __future__ import annotations

from datetime import datetime, timezone
import os
import json
from pathlib import Path
import signal
import socket
import subprocess
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

from pydantic import BaseModel
import yaml

from robotick_hub.manifest import Manifest, load_manifest

ACTIVE_STUDIO_CHILDREN: dict[int, subprocess.Popen[object]] = {}
ACTIVE_STUDIO_CHILDREN_LOCK = threading.Lock()


def ensure_launcher_with_action(_workspace_root: str | Path) -> tuple[None, str]:
    # Studio now talks to the launcher ability hosted inside robotick-hub.
    return None, "reused"


class StudioInstanceRecord(BaseModel):
    name: str
    pid: int
    mode: str
    log_path: str | None = None
    project_name: str | None = None
    project_dir: str | None = None
    started_at: str
    control_endpoint: str | None = None


def get_instances_dir(workspace_root: str | Path) -> Path:
    return Path(workspace_root) / ".robotick" / "instances"


def get_instance_record_path(workspace_root: str | Path, instance_name: str) -> Path:
    return get_instances_dir(workspace_root) / f"{instance_name}.json"


def create_instance_name(pid: int | None) -> str | None:
    if not pid:
        return None
    return f"studio-{pid}"


def write_instance_record(workspace_root: str | Path, record: StudioInstanceRecord) -> None:
    instances_dir = get_instances_dir(workspace_root)
    instances_dir.mkdir(parents=True, exist_ok=True)
    get_instance_record_path(workspace_root, record.name).write_text(
        f"{record.model_dump_json(indent=2)}\n",
        encoding="utf-8",
    )


def update_instance_control_endpoint(
    workspace_root: str | Path,
    instance_name: str,
    endpoint: str,
) -> StudioInstanceRecord | None:
    validate_studio_control_endpoint(endpoint)
    instance = read_instance_record(workspace_root, normalize_instance_specifier(instance_name))
    if instance is None:
        return None
    updated = instance.model_copy(update={"control_endpoint": endpoint})
    write_instance_record(workspace_root, updated)
    return updated


def remove_instance_record(workspace_root: str | Path, instance_name: str) -> None:
    record_path = get_instance_record_path(workspace_root, instance_name)
    if record_path.exists():
        record_path.unlink()


def register_studio_child_process(child: subprocess.Popen[object]) -> None:
    if child.pid is None:
        return
    with ACTIVE_STUDIO_CHILDREN_LOCK:
        ACTIVE_STUDIO_CHILDREN[child.pid] = child

    def reap_child() -> None:
        try:
            child.wait()
        except Exception:
            return
        finally:
            with ACTIVE_STUDIO_CHILDREN_LOCK:
                ACTIVE_STUDIO_CHILDREN.pop(child.pid, None)

    threading.Thread(
        target=reap_child,
        name=f"robotick-hub-studio-reaper-{child.pid}",
        daemon=True,
    ).start()


def read_instance_record(workspace_root: str | Path, instance_name: str) -> StudioInstanceRecord | None:
    record_path = get_instance_record_path(workspace_root, instance_name)
    if not record_path.exists():
        return None
    try:
        return StudioInstanceRecord.model_validate_json(record_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def normalize_instance_specifier(value: str) -> str:
    return value[:-1] if value.endswith("/") else value


def is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def parse_started_at(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def instance_started_recently(
    instance: StudioInstanceRecord,
    *,
    grace_seconds: float = 30.0,
) -> bool:
    started_at = parse_started_at(instance.started_at)
    if started_at is None:
        return False
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    age_seconds = (datetime.now(timezone.utc) - started_at).total_seconds()
    return age_seconds < grace_seconds


def list_unix_process_group_processes(process_group_id: int) -> list[dict[str, object]]:
    result = subprocess.run(
        ["ps", "-eo", "pid=,pgid=,args="],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not result.stdout:
        if not is_pid_alive(process_group_id):
            return []
        return [{"pid": process_group_id, "pgid": process_group_id, "args": ""}]

    members: list[dict[str, object]] = []
    for raw_line in result.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            pid_text, pgid_text, args = line.split(None, 2)
            pid = int(pid_text)
            pgid = int(pgid_text)
        except ValueError:
            continue
        if pgid == process_group_id:
            members.append({"pid": pid, "pgid": pgid, "args": args})
    return members


def list_unix_process_group_members(process_group_id: int) -> list[int]:
    return [int(member["pid"]) for member in list_unix_process_group_processes(process_group_id)]


def is_studio_ui_process_command(command: str) -> bool:
    normalized = command.strip()
    if not normalized:
        return False
    return any(
        marker in normalized
        for marker in (
            "Robotick Studio",
            "run-studio-dev-direct.sh",
            "run-studio-production-direct.sh",
            "electron .",
            "/electron .",
            "node_modules/.bin/electron",
            " dist/electron/main/main.js",
        )
    )


def has_studio_ui_process(process_group_id: int) -> bool:
    return any(
        is_studio_ui_process_command(str(member["args"]))
        for member in list_unix_process_group_processes(process_group_id)
    )


def is_instance_alive(instance: StudioInstanceRecord) -> bool:
    if os.name == "nt":
        return is_pid_alive(instance.pid)
    members = list_unix_process_group_processes(instance.pid)
    if not members:
        return False
    if any(is_studio_ui_process_command(str(member["args"])) for member in members):
        return True
    return instance_started_recently(instance)


def reap_instance_process_group(instance: StudioInstanceRecord) -> None:
    if os.name == "nt":
        return
    members = list_unix_process_group_members(instance.pid)
    if not members:
        return
    try:
        signal_instance_process_tree(instance.pid, signal.SIGTERM)
    except OSError:
        return
    if wait_for_instance_exit(instance.pid, 1500):
        return
    try:
        signal_instance_process_tree(instance.pid, signal.SIGKILL)
    except OSError:
        return
    wait_for_instance_exit(instance.pid, 1500)


def release_project_lock(instance: StudioInstanceRecord) -> None:
    if not instance.project_dir:
        return
    lock_path = Path(instance.project_dir) / "studio" / "studio.lock"
    if not lock_path.exists():
        return
    try:
        payload = json.loads(lock_path.read_text(encoding="utf-8"))
    except Exception:
        return
    if not isinstance(payload, dict):
        return
    if payload.get("pid") != instance.pid and payload.get("instanceName") != instance.name:
        return
    try:
        lock_path.unlink()
    except FileNotFoundError:
        return


def classify_instance_state(instance: StudioInstanceRecord) -> str:
    return "running" if is_instance_alive(instance) else "stale"


def summarize_instance(
    instance: StudioInstanceRecord,
    *,
    include_project_name: bool = True,
) -> dict[str, object]:
    return {
        "name": instance.name,
        "pid": instance.pid,
        "mode": instance.mode,
        "started_at": instance.started_at,
        "state": classify_instance_state(instance),
        "project_name": instance.project_name if include_project_name else None,
        "log_path": instance.log_path,
        "control_endpoint": instance.control_endpoint,
    }


def build_default_layout_id(window_id: str, workbench_id: str, index: int) -> str:
    if index == 0:
        return f"{window_id}:{workbench_id}:default"
    return f"{window_id}:{workbench_id}:layout-{index + 1}"


def build_default_layout_label(workbench_label: str, index: int) -> str:
    if index == 0:
        return f"{workbench_label} | Default"
    return f"{workbench_label} | Layout {index + 1}"


def clone_value(value: object) -> object:
    if isinstance(value, dict):
        return {str(key): clone_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clone_value(item) for item in value]
    return value


def normalize_dock_node(node: object) -> dict[str, object]:
    if not isinstance(node, dict):
        return {
            "nodeType": "panel",
            "panelId": "panel-missing",
            "editorId": "unknown",
        }
    node_type = str(node.get("nodeType") or "")
    if node_type == "split":
        children = node.get("children")
        normalized_children = (
            [normalize_dock_node(children[0]), normalize_dock_node(children[1])]
            if isinstance(children, list) and len(children) == 2
            else [
                {
                    "nodeType": "panel",
                    "panelId": "panel-missing-left",
                    "editorId": "unknown",
                },
                {
                    "nodeType": "panel",
                    "panelId": "panel-missing-right",
                    "editorId": "unknown",
                },
            ]
        )
        return {
            "nodeType": "split",
            "direction": str(node.get("direction") or "horizontal"),
            "ratio": float(node.get("ratio") or 0.5),
            "children": normalized_children,
        }
    return {
        "nodeType": "panel",
        "panelId": str(node.get("panelId") or "panel-missing"),
        "editorId": str(node.get("editorId") or "unknown"),
        **(
            {"label": str(node["label"])}
            if isinstance(node.get("label"), str)
            else {}
        ),
        **(
            {"settings": clone_value(node["settings"])}
            if isinstance(node.get("settings"), dict)
            else {}
        ),
    }


def extract_docked_panels(
    node: dict[str, object],
    *,
    instance_name: str,
    window_id: str,
    workbench_id: str,
    layout_id: str,
) -> list[dict[str, object]]:
    node_type = str(node.get("nodeType") or "")
    if node_type == "split":
        children = node.get("children")
        if not isinstance(children, list):
            return []
        panels: list[dict[str, object]] = []
        for child in children:
            if isinstance(child, dict):
                panels.extend(
                    extract_docked_panels(
                        child,
                        instance_name=instance_name,
                        window_id=window_id,
                        workbench_id=workbench_id,
                        layout_id=layout_id,
                    )
                )
        return panels
    return [
        {
            "resource_type": "studio_panel",
            "id": str(node.get("panelId") or "panel-missing"),
            "panel_location": "docked",
            "instance_id": instance_name,
            "window_id": window_id,
            "workbench_id": workbench_id,
            "layout_id": layout_id,
            "editor_id": str(node.get("editorId") or "unknown"),
            "label": str(node.get("label") or node.get("panelId") or "panel"),
            "settings": clone_value(node.get("settings") or {}),
            "diagnostics": {"source": "placeholder", "items": []},
        }
    ]


def normalize_layout(
    layout: object,
    *,
    instance_name: str,
    window_id: str,
    workbench_id: str,
    workbench_label: str,
    index: int,
) -> dict[str, object]:
    payload = layout if isinstance(layout, dict) else {}
    layout_id = str(payload.get("id") or build_default_layout_id(window_id, workbench_id, index))
    dock = normalize_dock_node(payload.get("dock"))
    docked_panels = extract_docked_panels(
        dock,
        instance_name=instance_name,
        window_id=window_id,
        workbench_id=workbench_id,
        layout_id=layout_id,
    )
    floating_panels: list[dict[str, object]] = []
    raw_floating = payload.get("floatingPanels")
    if isinstance(raw_floating, list):
        for panel in raw_floating:
            if not isinstance(panel, dict):
                continue
            floating_panels.append(
                {
                    "resource_type": "studio_panel",
                    "id": str(panel.get("id") or "panel-floating"),
                    "panel_location": "floating",
                    "instance_id": instance_name,
                    "window_id": window_id,
                    "workbench_id": workbench_id,
                    "layout_id": layout_id,
                    "editor_id": str(panel.get("editorId") or "unknown"),
                    "label": str(panel.get("label") or panel.get("id") or "panel"),
                    "settings": clone_value(panel.get("settings") or {}),
                    "frame": clone_value(panel.get("frame") or {}),
                    "diagnostics": {"source": "placeholder", "items": []},
                }
            )
    panels = [*docked_panels, *floating_panels]
    return {
        "resource_type": "studio_layout",
        "id": layout_id,
        "label": str(payload.get("label") or build_default_layout_label(workbench_label, index)),
        "instance_id": instance_name,
        "window_id": window_id,
        "workbench_id": workbench_id,
        "dock": dock,
        "docked_panels": docked_panels,
        "floating_panels": floating_panels,
        "panels": panels,
        "diagnostics": {
            "source": "computed",
            "items": [],
            "panel_count": len(panels),
            "floating_panel_count": len(floating_panels),
        },
    }


def build_default_layout(
    *,
    instance_name: str,
    window_id: str,
    workbench_id: str,
    workbench_label: str,
    default_editor_id: str,
) -> dict[str, object]:
    return normalize_layout(
        {
            "id": build_default_layout_id(window_id, workbench_id, 0),
            "label": build_default_layout_label(workbench_label, 0),
            "dock": {
                "nodeType": "panel",
                "panelId": f"panel-{workbench_id}",
                "editorId": default_editor_id,
            },
            "floatingPanels": [],
        },
        instance_name=instance_name,
        window_id=window_id,
        workbench_id=workbench_id,
        workbench_label=workbench_label,
        index=0,
    )


def normalize_workbench(
    workbench: object,
    *,
    instance_name: str,
    window_id: str,
) -> dict[str, object]:
    payload = workbench if isinstance(workbench, dict) else {}
    workbench_id = str(payload.get("id") or "workbench")
    label = str(payload.get("label") or workbench_id)
    default_editor_id = str(payload.get("defaultEditorId") or "unknown")
    raw_layouts = payload.get("layouts")
    layouts = (
        [
            normalize_layout(
                entry,
                instance_name=instance_name,
                window_id=window_id,
                workbench_id=workbench_id,
                workbench_label=label,
                index=index,
            )
            for index, entry in enumerate(raw_layouts)
            if isinstance(raw_layouts, list)
        ]
        if isinstance(raw_layouts, list) and raw_layouts
        else [
            build_default_layout(
                instance_name=instance_name,
                window_id=window_id,
                workbench_id=workbench_id,
                workbench_label=label,
                default_editor_id=default_editor_id,
            )
        ]
    )
    default_layout_id = str(
        payload.get("defaultLayoutId") or layouts[0]["id"]
    )
    return {
        "resource_type": "studio_workbench",
        "id": workbench_id,
        "label": label,
        "instance_id": instance_name,
        "window_id": window_id,
        "path": str(payload.get("path") or f"/{workbench_id}"),
        "group": payload.get("group"),
        "default_editor_id": default_editor_id,
        "default_layout_id": default_layout_id,
        "active_layout_id": default_layout_id,
        "state_sources": {
            "default_layout_id": "config",
            "active_layout_id": "config",
        },
        "layouts": layouts,
    }


def normalize_window(
    window: object,
    *,
    instance_name: str,
) -> dict[str, object]:
    payload = window if isinstance(window, dict) else {}
    window_id = str(payload.get("id") or "main")
    raw_workbenches = payload.get("workbenches")
    workbenches = [
        normalize_workbench(
            workbench,
            instance_name=instance_name,
            window_id=window_id,
        )
        for workbench in (raw_workbenches if isinstance(raw_workbenches, list) else [])
    ]
    default_workbench_id = str(
        payload.get("defaultWorkbenchId") or (workbenches[0]["id"] if workbenches else "")
    )
    active_workbench_id = default_workbench_id or None
    return {
        "resource_type": "studio_window",
        "id": window_id,
        "label": str(payload.get("label") or window_id),
        "instance_id": instance_name,
        "window_role": str(payload.get("windowRole") or "main"),
        "default_workbench_id": active_workbench_id,
        "active_workbench_id": active_workbench_id,
        "state_sources": {
            "default_workbench_id": "config",
            "active_workbench_id": "config",
        },
        "workbenches": workbenches,
    }


def load_studio_document_for_instance(
    workspace_root: str | Path,
    instance: StudioInstanceRecord,
) -> dict[str, object]:
    manifest = load_manifest(workspace_root)
    candidate_paths: list[Path] = []
    if instance.project_dir:
        candidate_paths.append(Path(instance.project_dir) / "studio" / "studio.yaml")
    candidate_paths.append(
        (Path(workspace_root) / manifest.studio.default_path / "studio.template.yaml").resolve()
    )
    for path in candidate_paths:
        if not path.exists():
            continue
        loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if isinstance(loaded, dict):
            return loaded
    return {"resourceType": "studio_document", "schemaVersion": 1, "id": "studio", "windows": []}


def build_instance_status(
    workspace_root: str | Path,
    instance: StudioInstanceRecord,
) -> dict[str, object]:
    summary = summarize_instance(instance)
    document = load_studio_document_for_instance(workspace_root, instance)
    raw_windows = document.get("windows")
    windows = [
        normalize_window(window, instance_name=instance.name)
        for window in (raw_windows if isinstance(raw_windows, list) else [])
    ]
    active_window_id = (
        "main"
        if any(window["id"] == "main" for window in windows)
        else (windows[0]["id"] if windows else None)
    )
    return {
        "resource_type": "studio_instance",
        "id": instance.name,
        **summary,
        "project_dir": instance.project_dir,
        "active_window_id": active_window_id,
        "state_sources": {"active_window_id": "config"},
        "windows": windows,
    }


def build_collection_node(
    parent: dict[str, object],
    collection_name: str,
    items: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "resource_type": f"studio_{collection_name}",
        "id": collection_name,
        "parent_id": parent.get("id"),
        "items": items,
    }


def child_collection_name(resource_type: str) -> str | None:
    return {
        "studio_instance": "windows",
        "studio_window": "workbenches",
        "studio_workbench": "layouts",
        "studio_layout": "panels",
    }.get(resource_type)


def resolve_status_node(
    instance_status: dict[str, object],
    path_segments: tuple[str, ...],
) -> dict[str, object]:
    node = instance_status
    index = 0
    while index < len(path_segments):
        segment = path_segments[index]
        resource_type = str(node.get("resource_type") or "")
        collection_name = child_collection_name(resource_type)
        if collection_name is None or segment != collection_name:
            raise KeyError(segment)
        raw_items = node.get(collection_name)
        items = [
            item
            for item in (raw_items if isinstance(raw_items, list) else [])
            if isinstance(item, dict)
        ]
        if index == len(path_segments) - 1:
            return build_collection_node(node, collection_name, items)
        item_id = path_segments[index + 1]
        next_node = next((item for item in items if str(item.get("id")) == item_id), None)
        if next_node is None:
            raise KeyError(item_id)
        node = next_node
        index += 2
    return node


def summarize_child_node(node: dict[str, object]) -> dict[str, object]:
    resource_type = str(node.get("resource_type") or "")
    if resource_type == "studio_window":
        return {
            "resource_type": resource_type,
            "id": node.get("id"),
            "label": node.get("label"),
            "window_role": node.get("window_role"),
        }
    if resource_type == "studio_workbench":
        return {
            "resource_type": resource_type,
            "id": node.get("id"),
            "label": node.get("label"),
            "group": node.get("group"),
            "path": node.get("path"),
        }
    if resource_type == "studio_layout":
        diagnostics = node.get("diagnostics")
        panel_count = diagnostics.get("panel_count") if isinstance(diagnostics, dict) else None
        floating_panel_count = (
            diagnostics.get("floating_panel_count") if isinstance(diagnostics, dict) else None
        )
        return {
            "resource_type": resource_type,
            "id": node.get("id"),
            "label": node.get("label"),
            "panel_count": panel_count,
            "floating_panel_count": floating_panel_count,
        }
    if resource_type == "studio_panel":
        return {
            "resource_type": resource_type,
            "id": node.get("id"),
            "label": node.get("label"),
            "panel_location": node.get("panel_location"),
            "editor_id": node.get("editor_id"),
        }
    return {
        "resource_type": resource_type,
        "id": node.get("id"),
    }


def build_child_collections(node: dict[str, object]) -> list[dict[str, object]]:
    resource_type = str(node.get("resource_type") or "")
    collection_name = child_collection_name(resource_type)
    if collection_name is None:
        return []
    raw_items = node.get(collection_name)
    item_count = len([item for item in raw_items if isinstance(item, dict)]) if isinstance(raw_items, list) else 0
    return [
        {
            "name": collection_name,
            "resource_type": f"studio_{collection_name}",
            "item_count": item_count,
        }
    ]


def build_child_resources(node: dict[str, object]) -> list[dict[str, object]]:
    resource_type = str(node.get("resource_type") or "")
    if resource_type not in {
        "studio_windows",
        "studio_workbenches",
        "studio_layouts",
        "studio_panels",
    }:
        return []
    items = node.get("items")
    return [
        summarize_child_node(item)
        for item in (items if isinstance(items, list) else [])
        if isinstance(item, dict)
    ]


def build_status_view(node: dict[str, object]) -> dict[str, object]:
    resource_type = str(node.get("resource_type") or "")
    if resource_type == "studio_instance":
        windows = node.get("windows")
        return {
            "resource_type": resource_type,
            "id": node.get("id"),
            "name": node.get("name"),
            "pid": node.get("pid"),
            "mode": node.get("mode"),
            "started_at": node.get("started_at"),
            "state": node.get("state"),
            "project_name": node.get("project_name"),
            "log_path": node.get("log_path"),
            "control_endpoint": node.get("control_endpoint"),
            "project_dir": node.get("project_dir"),
            "active_window_id": node.get("active_window_id"),
            "state_sources": node.get("state_sources"),
            "children": {
                "windows": [
                    summarize_child_node(window)
                    for window in (windows if isinstance(windows, list) else [])
                    if isinstance(window, dict)
                ]
            },
            "child_collections": build_child_collections(node),
        }
    if resource_type == "studio_window":
        workbenches = node.get("workbenches")
        return {
            "resource_type": resource_type,
            "id": node.get("id"),
            "label": node.get("label"),
            "instance_id": node.get("instance_id"),
            "window_role": node.get("window_role"),
            "default_workbench_id": node.get("default_workbench_id"),
            "active_workbench_id": node.get("active_workbench_id"),
            "state_sources": node.get("state_sources"),
            "children": {
                "workbenches": [
                    summarize_child_node(workbench)
                    for workbench in (workbenches if isinstance(workbenches, list) else [])
                    if isinstance(workbench, dict)
                ]
            },
            "child_collections": build_child_collections(node),
        }
    if resource_type == "studio_workbench":
        layouts = node.get("layouts")
        return {
            "resource_type": resource_type,
            "id": node.get("id"),
            "label": node.get("label"),
            "instance_id": node.get("instance_id"),
            "window_id": node.get("window_id"),
            "path": node.get("path"),
            "group": node.get("group"),
            "default_editor_id": node.get("default_editor_id"),
            "default_layout_id": node.get("default_layout_id"),
            "active_layout_id": node.get("active_layout_id"),
            "state_sources": node.get("state_sources"),
            "children": {
                "layouts": [
                    summarize_child_node(layout)
                    for layout in (layouts if isinstance(layouts, list) else [])
                    if isinstance(layout, dict)
                ]
            },
            "child_collections": build_child_collections(node),
        }
    if resource_type == "studio_layout":
        panels = node.get("panels")
        return {
            "resource_type": resource_type,
            "id": node.get("id"),
            "label": node.get("label"),
            "instance_id": node.get("instance_id"),
            "window_id": node.get("window_id"),
            "workbench_id": node.get("workbench_id"),
            "dock": node.get("dock"),
            "diagnostics": node.get("diagnostics"),
            "children": {
                "panels": [
                    summarize_child_node(panel)
                    for panel in (panels if isinstance(panels, list) else [])
                    if isinstance(panel, dict)
                ]
            },
            "child_collections": build_child_collections(node),
        }
    if resource_type in {
        "studio_windows",
        "studio_workbenches",
        "studio_layouts",
        "studio_panels",
    }:
        items = node.get("items")
        return {
            "resource_type": resource_type,
            "id": node.get("id"),
            "parent_id": node.get("parent_id"),
            "items": build_child_resources(node),
            "child_resources": build_child_resources(node),
        }
    return {
        **node,
        "child_collections": build_child_collections(node),
    }


def get_studio_capability_status(workspace_root: str | Path) -> str:
    try:
        manifest = load_manifest(workspace_root)
        resolve_studio_runner_path(workspace_root, manifest)
    except Exception:
        return "unavailable"
    return "available"


def list_instances(workspace_root: str | Path) -> list[dict[str, object]]:
    instances_dir = get_instances_dir(workspace_root)
    if not instances_dir.exists():
        return []

    instances: list[dict[str, object]] = []
    for entry in instances_dir.iterdir():
        if entry.suffix != ".json":
            continue
        instance = read_instance_record(workspace_root, entry.stem)
        if instance is None:
            continue
        if not is_instance_alive(instance):
            reap_instance_process_group(instance)
            release_project_lock(instance)
            remove_instance_record(workspace_root, instance.name)
            continue
        instances.append(summarize_instance(instance, include_project_name=False))
    return sorted(instances, key=lambda item: str(item["name"]))


def get_instance(workspace_root: str | Path, instance_name: str) -> dict[str, object] | None:
    instance = read_instance_record(workspace_root, normalize_instance_specifier(instance_name))
    if instance is None:
        return None
    if not is_instance_alive(instance):
        reap_instance_process_group(instance)
        release_project_lock(instance)
        remove_instance_record(workspace_root, instance.name)
        return None
    return summarize_instance(instance)


def get_live_instance_record(
    workspace_root: str | Path,
    instance_name: str,
) -> StudioInstanceRecord | None:
    instance = read_instance_record(workspace_root, normalize_instance_specifier(instance_name))
    if instance is None:
        return None
    if not is_instance_alive(instance):
        reap_instance_process_group(instance)
        release_project_lock(instance)
        remove_instance_record(workspace_root, instance.name)
        return None
    return instance


def build_provider_unavailable_error(
    instance: StudioInstanceRecord,
    provider_name: str,
    *,
    recovery: str,
) -> dict[str, object]:
    return {
        "error": {
            "code": "provider_unavailable",
            "message": f"Studio provider '{provider_name}' is not available for {instance.name}.",
            "recovery": recovery,
        }
    }


def validate_studio_control_endpoint(endpoint: str) -> None:
    parsed = urlparse(endpoint)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or not parsed.port:
        raise ValueError(f"Invalid Studio control endpoint: {endpoint}")


def fetch_studio_control_status(
    instance: StudioInstanceRecord,
    path_segments: tuple[str, ...],
) -> dict[str, object] | None:
    if not instance.control_endpoint:
        return None
    validate_studio_control_endpoint(instance.control_endpoint)
    resource_path = "/".join(quote(segment, safe="") for segment in path_segments)
    url = (
        f"{instance.control_endpoint}/v1/status"
        if not resource_path
        else f"{instance.control_endpoint}/v1/studio/{resource_path}/status"
    )
    try:
        with urlopen(url, timeout=1.5) as response:
            loaded = yaml.safe_load(response.read().decode("utf-8"))
    except URLError:
        return None
    if not isinstance(loaded, dict):
        return None
    return loaded


def fetch_studio_control_focused(
    instance: StudioInstanceRecord,
) -> dict[str, object] | None:
    if not instance.control_endpoint:
        return None
    validate_studio_control_endpoint(instance.control_endpoint)
    try:
        with urlopen(f"{instance.control_endpoint}/v1/focused", timeout=1.5) as response:
            loaded = yaml.safe_load(response.read().decode("utf-8"))
    except URLError:
        return None
    if not isinstance(loaded, dict):
        return None
    return loaded


def fetch_studio_control_diagnostics(
    instance: StudioInstanceRecord,
    kind: str,
) -> dict[str, object] | None:
    if not instance.control_endpoint:
        return None
    validate_studio_control_endpoint(instance.control_endpoint)
    try:
        with urlopen(f"{instance.control_endpoint}/v1/diagnostics/{quote(kind, safe='')}", timeout=1.5) as response:
            loaded = yaml.safe_load(response.read().decode("utf-8"))
    except URLError:
        return None
    if not isinstance(loaded, dict):
        return None
    return loaded


def get_studio_focused(
    workspace_root: str | Path,
    instance_name: str,
) -> dict[str, object] | None:
    instance = get_live_instance_record(workspace_root, instance_name)
    if instance is None:
        return None
    if not instance.control_endpoint:
        return build_provider_unavailable_error(
            instance,
            "focused",
            recovery="Reopen the Studio instance so it registers the current control-service focused route.",
        )
    control_focused = fetch_studio_control_focused(instance)
    if control_focused is not None:
        return control_focused
    return build_provider_unavailable_error(
        instance,
        "focused",
        recovery="Reopen the Studio instance so it registers the current control-service focused route.",
    )


def select_studio_project(
    workspace_root: str | Path,
    instance_name: str,
    project_path: str,
) -> tuple[int, dict[str, object]] | None:
    instance = get_live_instance_record(workspace_root, instance_name)
    if instance is None:
        return None
    if not instance.control_endpoint:
        return (
            503,
            build_provider_unavailable_error(
                instance,
                "project-select",
                recovery="Reopen the Studio instance so it registers the current control-service project selection route.",
            ),
        )
    validate_studio_control_endpoint(instance.control_endpoint)
    request = Request(
        f"{instance.control_endpoint}/v1/project/select",
        data=json.dumps({"project_path": project_path}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=1.5) as response:
            status_code = int(response.status)
            loaded = yaml.safe_load(response.read().decode("utf-8"))
    except HTTPError as error:
        status_code = int(error.code)
        loaded = yaml.safe_load(error.read().decode("utf-8"))
    except URLError:
        return (
            503,
            build_provider_unavailable_error(
                instance,
                "project-select",
                recovery="Reopen the Studio instance so it registers the current control-service project selection route.",
            ),
        )
    if not isinstance(loaded, dict):
        return None
    return status_code, loaded


def activate_studio_resource(
    workspace_root: str | Path,
    instance_name: str,
    path_segments: tuple[str, ...] = (),
) -> tuple[int, dict[str, object]] | None:
    instance = get_live_instance_record(workspace_root, instance_name)
    if instance is None:
        return None
    if not instance.control_endpoint:
        return (
            503,
            build_provider_unavailable_error(
                instance,
                "activate",
                recovery="Reopen the Studio instance so it registers the current control-service activation route.",
            ),
        )
    validate_studio_control_endpoint(instance.control_endpoint)
    resource_path = "/".join(quote(segment, safe="") for segment in path_segments)
    url = (
        f"{instance.control_endpoint}/v1/activate"
        if not resource_path
        else f"{instance.control_endpoint}/v1/studio/{resource_path}/activate"
    )
    request = Request(url, data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=1.5) as response:
            status_code = int(response.status)
            loaded = yaml.safe_load(response.read().decode("utf-8"))
    except HTTPError as error:
        status_code = int(error.code)
        loaded = yaml.safe_load(error.read().decode("utf-8"))
    except URLError:
        return (
            503,
            build_provider_unavailable_error(
                instance,
                "activate",
                recovery="Reopen the Studio instance so it registers the current control-service activation route.",
            ),
        )
    if not isinstance(loaded, dict):
        return None
    return status_code, loaded


def get_studio_status(
    workspace_root: str | Path,
    instance_name: str,
    path_segments: tuple[str, ...] = (),
) -> dict[str, object] | None:
    instance = get_live_instance_record(workspace_root, instance_name)
    if instance is None:
        return None
    if not instance.control_endpoint:
        return build_provider_unavailable_error(
            instance,
            "status",
            recovery="Reopen the Studio instance so it registers the current control-service status routes.",
        )
    control_status = fetch_studio_control_status(instance, path_segments)
    if control_status is not None:
        return control_status
    return build_provider_unavailable_error(
        instance,
        "status",
        recovery="Reopen the Studio instance so it registers the current control-service status routes.",
    )


def get_studio_diagnostics(
    workspace_root: str | Path,
    instance_name: str,
    kind: str,
) -> dict[str, object] | None:
    instance = get_live_instance_record(workspace_root, instance_name)
    if instance is None:
        return None
    if not instance.control_endpoint:
        return build_provider_unavailable_error(
            instance,
            f"diagnostics:{kind}",
            recovery="Reopen the Studio instance so it registers the current control-service diagnostics routes.",
        )
    diagnostics = fetch_studio_control_diagnostics(instance, kind)
    if diagnostics is not None:
        return diagnostics
    return build_provider_unavailable_error(
        instance,
        f"diagnostics:{kind}",
        recovery="Reopen the Studio instance so it registers the current control-service diagnostics routes.",
    )


def find_instance_record_by_process_member(
    workspace_root: str | Path,
    process_id: int,
) -> StudioInstanceRecord | None:
    instances_dir = get_instances_dir(workspace_root)
    if not instances_dir.exists():
        return None
    for entry in instances_dir.iterdir():
        if entry.suffix != ".json":
            continue
        instance = read_instance_record(workspace_root, entry.stem)
        if instance is None:
            continue
        if os.name == "nt":
            if instance.pid == process_id:
                return instance
            continue
        if process_id in list_unix_process_group_members(instance.pid):
            return instance
    return None


def notify_instance_closing(
    workspace_root: str | Path,
    *,
    app_id: str,
    process_id: int | None = None,
    instance_name: str | None = None,
) -> tuple[bool, str, dict[str, object] | None]:
    if app_id != "studio":
        return False, f"Unsupported app closing signal for {app_id}.", None

    record: StudioInstanceRecord | None = None
    if instance_name:
        record = read_instance_record(
            workspace_root,
            normalize_instance_specifier(instance_name),
        )
    if record is None and process_id is not None:
        record = find_instance_record_by_process_member(workspace_root, process_id)
    if record is None:
        return False, "No tracked Studio instance matched the closing signal.", None

    summary = summarize_instance(record)
    remove_instance_record(workspace_root, record.name)
    return True, f"Studio instance {record.name} marked closing.", summary


def create_studio_log_path(workspace_root: str | Path, project_name: str) -> Path:
    logs_dir = Path(workspace_root) / ".robotick" / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).isoformat().replace(":", "-")
    return logs_dir / f"studio-open-{project_name}-{timestamp}.log"


def resolve_studio_runner_path(workspace_root: str | Path, manifest: Manifest) -> str:
    studio_dir = Path(
        os.environ.get(
            "ROBOTICK_STUDIO_DIR",
            str((Path(workspace_root) / manifest.studio.default_path).resolve()),
        )
    )
    mode = os.environ.get("ROBOTICK_STUDIO_MODE", manifest.studio.default_mode)
    runner_name = (
        "run-studio-production-direct.sh"
        if mode == "production"
        else "run-studio-dev-direct.sh"
    )
    runner = studio_dir / runner_name
    if not runner.exists():
        raise FileNotFoundError(f"Expected Studio runner at {runner}")
    return str(runner)


def find_available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        return int(server.getsockname()[1])


def create_studio_launch_env(
    workspace_root: str | Path,
    manifest: Manifest,
    *,
    project_name: str | None,
    project_dir: str | None,
) -> dict[str, str]:
    remote_debugging_port = os.environ.get("ROBOTICK_REMOTE_DEBUGGING_PORT") or str(
        find_available_port()
    )
    host = os.environ.get("ROBOTICK_HUB_HOST", "127.0.0.1")
    port = os.environ["ROBOTICK_HUB_PORT"]
    env = {
        **os.environ,
        "ROBOTICK_WORKSPACE_ROOT": str(workspace_root),
        "ROBOTICK_STUDIO_MODE": os.environ.get(
            "ROBOTICK_STUDIO_MODE", manifest.studio.default_mode
        ),
        "ROBOTICK_STUDIO_DIR": os.environ.get(
            "ROBOTICK_STUDIO_DIR",
            str((Path(workspace_root) / manifest.studio.default_path).resolve()),
        ),
        "ROBOTICK_REMOTE_DEBUGGING_PORT": remote_debugging_port,
        "ROBOTICK_HUB_ENDPOINT": f"http://{host}:{port}",
        "ROBOTICK_STUDIO_MANAGED_BY_HUB": "1",
        "ROBOTICK_STUDIO_DISABLE_MANAGED_LAUNCHER": "1",
    }
    if project_name is not None:
        env["ROBOTICK_STUDIO_SELECTED_PROJECT"] = project_name
    if project_dir is not None:
        env["ROBOTICK_PROJECT_DIR"] = str((Path(workspace_root) / project_dir).resolve())
    return env


def resolve_project_selection(
    workspace_root: str | Path,
    manifest: Manifest,
    project_name: str | None,
) -> tuple[str | None, str | None]:
    if project_name is None:
        return None, None

    project = manifest.projects.get(project_name)
    if project is None:
        names = ", ".join(sorted(manifest.projects))
        raise ValueError(f"Unknown project: {project_name}. Registered projects: {names}")
    project_dir = str((Path(workspace_root) / project.project_dir).resolve())
    if not Path(project_dir).exists():
        raise FileNotFoundError(f"Project directory not found: {project_dir}")
    return project.project_dir, project_name


def open_studio(
    workspace_root: str | Path,
    *,
    project_name: str | None,
) -> tuple[dict[str, object], dict[str, object]]:
    workspace_root = Path(workspace_root).resolve()
    manifest = load_manifest(workspace_root)
    selected_project_dir, selected_project = resolve_project_selection(
        workspace_root, manifest, project_name
    )
    selected_project_root = (
        str((Path(workspace_root) / selected_project_dir).resolve())
        if selected_project_dir is not None
        else None
    )
    launch_script = resolve_studio_runner_path(workspace_root, manifest)
    env = create_studio_launch_env(
        workspace_root,
        manifest,
        project_name=selected_project,
        project_dir=selected_project_dir,
    )
    log_path = create_studio_log_path(
        workspace_root, selected_project if selected_project is not None else "empty"
    )
    log_handle = open(log_path, "a", encoding="utf-8")
    try:
        child = subprocess.Popen(
            [launch_script],
            cwd=workspace_root,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )
    finally:
        log_handle.close()
    register_studio_child_process(child)

    instance_name = create_instance_name(child.pid)
    if instance_name is None:
        raise RuntimeError("Studio launch did not provide a process id.")

    record = StudioInstanceRecord(
        name=instance_name,
        pid=child.pid,
        mode=env["ROBOTICK_STUDIO_MODE"],
        log_path=str(log_path),
        project_name=selected_project,
        project_dir=selected_project_root,
        started_at=datetime.now(timezone.utc).isoformat(),
        control_endpoint=None,
    )
    write_instance_record(workspace_root, record)
    return summarize_instance(record), {"launcher_service": {"action": "reused"}}


def signal_instance_process_tree(pid: int, sig: signal.Signals) -> None:
    if os.name == "nt":
        os.kill(pid, sig)
        return
    os.killpg(pid, sig)


def is_instance_pid_active(instance_pid: int) -> bool:
    if os.name == "nt":
        return is_pid_alive(instance_pid)
    return len(list_unix_process_group_members(instance_pid)) > 0


def wait_for_instance_exit(instance_pid: int, timeout_ms: int) -> bool:
    started_at = time.time()
    while (time.time() - started_at) * 1000 < timeout_ms:
        if not is_instance_pid_active(instance_pid):
            return True
        time.sleep(0.1)
    return not is_instance_pid_active(instance_pid)


def quit_instance(workspace_root: str | Path, instance_name: str) -> tuple[bool, str, dict[str, object] | None]:
    normalized_name = normalize_instance_specifier(instance_name)
    record = read_instance_record(workspace_root, normalized_name)
    if record is None:
        remove_instance_record(workspace_root, normalized_name)
        return False, f"Studio instance {normalized_name} is no longer running.", None

    if record.control_endpoint:
        # Prefer a future Studio control API when one is registered.
        pass

    try:
        signal_instance_process_tree(record.pid, signal.SIGTERM)
        exited = wait_for_instance_exit(record.pid, 4000)
        if exited:
            remove_instance_record(workspace_root, record.name)
            return True, f"Studio instance {record.name} closed.", summarize_instance(record)

        signal_instance_process_tree(record.pid, signal.SIGKILL)
        killed = wait_for_instance_exit(record.pid, 1500)
        if killed:
            remove_instance_record(workspace_root, record.name)
            return (
                True,
                f"Studio instance {record.name} force-closed after not exiting cleanly.",
                summarize_instance(record),
            )
        return (
            False,
            f"Unable to close {record.name}. It is still running after TERM and KILL attempts.",
            summarize_instance(record),
        )
    except OSError:
        release_project_lock(record)
        remove_instance_record(workspace_root, record.name)
        return False, f"Unable to quit {record.name}. It may already have exited.", summarize_instance(record)
