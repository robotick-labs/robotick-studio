from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen

from pydantic import BaseModel

from robotick_cli.app.errors import HubRequestError, HubUnavailableError


class HubRecord(BaseModel):
    endpoint: str
    pid: int | None = None
    workspace_root: str | None = None
    started_at: str | None = None


def get_hub_record_path(workspace_root: str | Path) -> Path:
    return Path(workspace_root) / ".robotick" / "hub.json"


def discover_hub(workspace_root: str | Path) -> HubRecord | None:
    record_path = get_hub_record_path(workspace_root)
    if not record_path.exists():
        return None
    try:
        return HubRecord.model_validate_json(record_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def is_pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def is_hub_healthy(record: HubRecord) -> bool:
    try:
        payload = fetch_hub_json(record, "/v1/health")
    except HubRequestError:
        return False
    return payload.get("status") == "ok"


def find_available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        return int(server.getsockname()[1])


def get_hub_dir(workspace_root: str | Path) -> Path:
    return (
        Path(workspace_root)
        / "robotick"
        / "robotick-studio"
        / "tools"
        / "robotick-hub"
    ).resolve()


def start_hub(workspace_root: str | Path) -> None:
    workspace_root = Path(workspace_root).resolve()
    hub_dir = get_hub_dir(workspace_root)
    hub_src = hub_dir / "src"
    port = find_available_port()
    env = os.environ.copy()
    pythonpath_entries = [str(hub_src)]
    if env.get("PYTHONPATH"):
        pythonpath_entries.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(pythonpath_entries)
    env["ROBOTICK_WORKSPACE_ROOT"] = str(workspace_root)
    env["ROBOTICK_HUB_HOST"] = "127.0.0.1"
    env["ROBOTICK_HUB_PORT"] = str(port)
    log_dir = workspace_root / ".robotick" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "robotick-hub.log"
    with open(log_path, "a", encoding="utf-8") as log_handle:
        subprocess.Popen(
            [sys.executable, "-m", "robotick_hub"],
            cwd=workspace_root,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )


def ensure_hub(workspace_root: str | Path) -> HubRecord:
    record = discover_hub(workspace_root)
    if record is not None and is_pid_alive(record.pid) and is_hub_healthy(record):
        return record

    start_hub(workspace_root)
    started_at = time.time()
    while time.time() - started_at < 8:
        record = discover_hub(workspace_root)
        if record is not None and is_pid_alive(record.pid) and is_hub_healthy(record):
            return record
        time.sleep(0.1)
    raise HubUnavailableError("robotick-hub did not become ready.")


def fetch_hub_json(record: HubRecord, path: str) -> dict[str, Any]:
    url = f"{record.endpoint}{path}"
    try:
        with urlopen(url, timeout=2) as response:
            return json.loads(response.read().decode("utf-8"))
    except URLError as error:
        raise HubRequestError(f"Unable to reach robotick-hub at {record.endpoint}") from error

