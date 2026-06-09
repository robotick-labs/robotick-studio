from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import signal
import socket
import subprocess
import threading
import time

from pydantic import BaseModel
import yaml

from robotick_hub.launcher import ensure_launcher
from robotick_hub.manifest import Manifest, load_manifest

ACTIVE_STUDIO_CHILDREN: dict[int, subprocess.Popen[object]] = {}
ACTIVE_STUDIO_CHILDREN_LOCK = threading.Lock()


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


def classify_instance_state(instance: StudioInstanceRecord) -> str:
    return "running" if is_instance_alive(instance) else "stale"


def summarize_instance(instance: StudioInstanceRecord) -> dict[str, object]:
    return {
        "name": instance.name,
        "pid": instance.pid,
        "mode": instance.mode,
        "started_at": instance.started_at,
        "state": classify_instance_state(instance),
        "project_name": instance.project_name,
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
            "diagnostics": {},
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
                    "diagnostics": {},
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
        "windows": windows,
    }


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
            remove_instance_record(workspace_root, instance.name)
            continue
        instances.append(summarize_instance(instance))
    return sorted(instances, key=lambda item: str(item["name"]))


def get_instance(workspace_root: str | Path, instance_name: str) -> dict[str, object] | None:
    instance = read_instance_record(workspace_root, normalize_instance_specifier(instance_name))
    if instance is None:
        return None
    if not is_instance_alive(instance):
        reap_instance_process_group(instance)
        release_project_lock(instance.project_dir)
        remove_instance_record(workspace_root, instance.name)
        return None
    return summarize_instance(instance)


def get_instance_status(workspace_root: str | Path, instance_name: str) -> dict[str, object] | None:
    instance = read_instance_record(workspace_root, normalize_instance_specifier(instance_name))
    if instance is None:
        return None
    if not is_instance_alive(instance):
        reap_instance_process_group(instance)
        release_project_lock(instance.project_dir)
        remove_instance_record(workspace_root, instance.name)
        return None
    return build_instance_status(workspace_root, instance)


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
) -> dict[str, object]:
    workspace_root = Path(workspace_root).resolve()
    manifest = load_manifest(workspace_root)
    ensure_launcher(workspace_root)
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
    return summarize_instance(record)


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
        release_project_lock(record.project_dir)
        remove_instance_record(workspace_root, record.name)
        return False, f"Unable to quit {record.name}. It may already have exited.", summarize_instance(record)
