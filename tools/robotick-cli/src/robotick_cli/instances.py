from __future__ import annotations

import json
import os
from datetime import datetime, timezone
import signal
import subprocess
import time
from pathlib import Path

from pydantic import BaseModel

from robotick_cli.app.errors import HubRequestError
from robotick_cli.hub_client import discover_hub, fetch_hub_json


class InstanceRecord(BaseModel):
    name: str
    pid: int
    mode: str
    log_path: str | None = None
    project_name: str | None = None
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


def parse_instance_pid(instance_name: str) -> int | None:
    if not instance_name.startswith("studio-"):
        return None
    try:
        pid = int(instance_name.split("-", 1)[1])
    except ValueError:
        return None
    return pid if pid > 0 else None


def write_instance_record(workspace_root: str | Path, record: InstanceRecord) -> None:
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


def read_instance_record(workspace_root: str | Path, instance_name: str) -> InstanceRecord | None:
    record_path = get_instance_record_path(workspace_root, instance_name)
    if not record_path.exists():
        return None
    try:
        return InstanceRecord.model_validate_json(record_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def list_unix_process_group_members(process_group_id: int) -> list[int]:
    result = subprocess.run(
        ["ps", "-eo", "pid=,pgid="],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not result.stdout:
        return [process_group_id] if is_pid_alive(process_group_id) else []

    members: list[int] = []
    for raw_line in result.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            pid_text, pgid_text = line.split()
        except ValueError:
            continue
        try:
            pid = int(pid_text)
            pgid = int(pgid_text)
        except ValueError:
            continue
        if pgid == process_group_id:
            members.append(pid)
    return members


def is_instance_alive(instance: InstanceRecord) -> bool:
    if os.name == "nt":
        return is_pid_alive(instance.pid)
    return len(list_unix_process_group_members(instance.pid)) > 0


def parse_instance_summary(payload: dict[str, object]) -> InstanceRecord | None:
    try:
        return InstanceRecord.model_validate(payload)
    except Exception:
        return None


def list_hub_instances(workspace_root: str | Path) -> list[InstanceRecord] | None:
    record = discover_hub(workspace_root)
    if record is None:
        return None
    try:
        payload = fetch_hub_json(record, "/v1/studio/instances")
    except HubRequestError:
        return None

    items = payload.get("instances")
    if not isinstance(items, list):
        return None

    instances: list[InstanceRecord] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        instance = parse_instance_summary(item)
        if instance is not None:
            instances.append(instance)
    return sorted(instances, key=lambda item: item.name)


def list_live_instances(workspace_root: str | Path) -> list[InstanceRecord]:
    instances_dir = get_instances_dir(workspace_root)
    local_instances: dict[str, InstanceRecord] = {}
    if instances_dir.exists():
        for entry in instances_dir.iterdir():
            if entry.suffix != ".json":
                continue
            instance_name = entry.stem
            instance = read_instance_record(workspace_root, instance_name)
            if instance is None:
                continue
            if not is_instance_alive(instance):
                remove_instance_record(workspace_root, instance.name)
                continue
            local_instances[instance.name] = instance

    hub_instances = list_hub_instances(workspace_root)
    if hub_instances is None:
        return sorted(local_instances.values(), key=lambda item: item.name)

    merged_instances = {instance.name: instance for instance in hub_instances}
    for instance_name, instance in local_instances.items():
        merged_instances.setdefault(instance_name, instance)
    return sorted(merged_instances.values(), key=lambda item: item.name)


def get_live_instance(workspace_root: str | Path, instance_name: str) -> InstanceRecord | None:
    for instance in list_live_instances(workspace_root):
        if instance.name == instance_name:
            return instance
    return None


def normalize_instance_specifier(value: str) -> str:
    return value[:-1] if value.endswith("/") else value


def reconcile_bound_instance(workspace_root: str | Path, state) -> str | None:
    if state.namespace != "studio" or state.instance_name is None:
        return None
    if get_live_instance(workspace_root, state.instance_name) is not None:
        return None
    stale_name = state.instance_name
    state.instance_name = None
    return f"Studio instance {stale_name} closed."


def format_instance_contexts(instances: list[InstanceRecord]) -> list[str]:
    if not instances:
        return ["- none"]
    return [
        f"- {instance.name}/ ({format_instance_details(instance)})"
        for instance in instances
    ]


def format_instance_details(instance: InstanceRecord) -> str:
    details = ["running", instance.mode]
    if instance.project_name:
        details.append(instance.project_name)
    age = format_instance_age(instance.started_at)
    if age:
        details.append(age)
    return " | ".join(details)


def format_instance_age(started_at: str) -> str | None:
    try:
        started = datetime.fromisoformat(started_at)
    except ValueError:
        return None
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    age_seconds = max(0, int((datetime.now(timezone.utc) - started).total_seconds()))
    if age_seconds < 60:
        return f"{age_seconds}s"
    if age_seconds < 3600:
        return f"{age_seconds // 60}m"
    return f"{age_seconds // 3600}h"


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


def quit_studio_instance(workspace_root: str | Path, instance_name: str) -> tuple[bool, str]:
    instance = get_live_instance(workspace_root, instance_name)
    if instance is None:
        remove_instance_record(workspace_root, instance_name)
        return False, f"Studio instance {instance_name} is no longer running."

    pid = parse_instance_pid(instance.name)
    if pid is None:
        return False, f"Unable to quit {instance.name}. Invalid instance pid."

    try:
        signal_instance_process_tree(pid, signal.SIGTERM)
        exited = wait_for_instance_exit(pid, 4000)
        if exited:
            remove_instance_record(workspace_root, instance.name)
            return True, f"Studio instance {instance.name} closed."

        signal_instance_process_tree(pid, signal.SIGKILL)
        killed = wait_for_instance_exit(pid, 1500)
        if killed:
            remove_instance_record(workspace_root, instance.name)
            return True, (
                f"Studio instance {instance.name} force-closed after not exiting cleanly."
            )
        return (
            False,
            f"Unable to close {instance.name}. It is still running after TERM and KILL attempts.",
        )
    except OSError:
        return False, f"Unable to quit {instance.name}. It may already have exited."
