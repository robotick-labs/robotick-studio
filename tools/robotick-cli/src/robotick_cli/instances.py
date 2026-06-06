from __future__ import annotations

import json
import os
import signal
import subprocess
import time
from pathlib import Path

from pydantic import BaseModel


class InstanceRecord(BaseModel):
    name: str
    pid: int
    mode: str
    log_path: str | None = None
    project_name: str | None = None
    started_at: str


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


def list_live_instances(workspace_root: str | Path) -> list[InstanceRecord]:
    instances_dir = get_instances_dir(workspace_root)
    if not instances_dir.exists():
        return []

    instances: list[InstanceRecord] = []
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
        instances.append(instance)
    return sorted(instances, key=lambda item: item.name)


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
    return [f"- {instance.name}/" for instance in instances]


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
