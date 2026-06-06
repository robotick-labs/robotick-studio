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
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from pydantic import BaseModel


class LauncherRecord(BaseModel):
    endpoint: str
    pid: int | None = None
    workspace_root: str | None = None
    started_at: str | None = None
    python_executable: str | None = None


def get_launcher_record_path(workspace_root: str | Path) -> Path:
    return Path(workspace_root) / ".robotick" / "launcher.json"


def discover_launcher(workspace_root: str | Path) -> LauncherRecord | None:
    record_path = get_launcher_record_path(workspace_root)
    if not record_path.exists():
        return None
    try:
        return LauncherRecord.model_validate_json(record_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_launcher_record(
    workspace_root: str | Path,
    endpoint: str,
    pid: int | None,
    *,
    python_executable: str | None = None,
) -> LauncherRecord:
    record = LauncherRecord(
        endpoint=endpoint,
        pid=pid,
        workspace_root=str(Path(workspace_root).resolve()),
        started_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        python_executable=python_executable,
    )
    record_path = get_launcher_record_path(workspace_root)
    record_path.parent.mkdir(parents=True, exist_ok=True)
    record_path.write_text(f"{record.model_dump_json(indent=2)}\n", encoding="utf-8")
    return record


def remove_launcher_record(workspace_root: str | Path) -> None:
    record_path = get_launcher_record_path(workspace_root)
    if record_path.exists():
        record_path.unlink()


def is_pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def find_available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        return int(server.getsockname()[1])


def get_launcher_dir() -> Path:
    return Path(__file__).resolve().parents[2].parent / "robotick-launcher"


def validate_launcher_endpoint(endpoint: str) -> None:
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError(f"Invalid robotick-launcher endpoint: {endpoint}")


def fetch_launcher_json(record: LauncherRecord, path: str) -> dict[str, Any]:
    validate_launcher_endpoint(record.endpoint)
    url = f"{record.endpoint}{path}"
    try:
        with urlopen(url, timeout=2) as response:
            return json.loads(response.read().decode("utf-8"))
    except URLError as error:
        raise RuntimeError(f"Unable to reach robotick-launcher at {record.endpoint}") from error


def post_launcher_json(record: LauncherRecord, path: str) -> dict[str, Any]:
    validate_launcher_endpoint(record.endpoint)
    request = Request(f"{record.endpoint}{path}", method="POST")
    try:
        with urlopen(request, timeout=2) as response:
            return json.loads(response.read().decode("utf-8"))
    except URLError as error:
        raise RuntimeError(f"Unable to reach robotick-launcher at {record.endpoint}") from error


def proxy_launcher_request(
    record: LauncherRecord,
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, bytes, dict[str, str]]:
    validate_launcher_endpoint(record.endpoint)
    query = f"?{urlencode(params, doseq=True)}" if params else ""
    request = Request(
        f"{record.endpoint}{path}{query}",
        data=body,
        method=method.upper(),
        headers=headers or {},
    )
    try:
        with urlopen(request, timeout=10) as response:
            return (
                response.status,
                response.read(),
                dict(response.headers.items()),
            )
    except URLError as error:
        raise RuntimeError(f"Unable to reach robotick-launcher at {record.endpoint}") from error


def is_launcher_healthy(record: LauncherRecord) -> bool:
    try:
        fetch_launcher_json(record, "/launcher/status")
    except RuntimeError:
        return False
    return True


def stop_launcher_process(pid: int | None) -> None:
    if not pid:
        return
    try:
        os.kill(pid, 15)
    except OSError:
        return
    started_at = time.time()
    while time.time() - started_at < 3:
        if not is_pid_alive(pid):
            return
        time.sleep(0.05)
    try:
        os.kill(pid, 9)
    except OSError:
        return


def ensure_launcher_runtime_available(python_executable: str, env: dict[str, str]) -> None:
    result = subprocess.run(
        [python_executable, "-c", "import robotick.launcher.cli"],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode == 0:
        return
    details = (result.stderr or result.stdout).strip()
    suffix = f" Import failed with: {details}" if details else ""
    raise RuntimeError(
        "robotick-launcher cannot start because its Python runtime dependencies "
        f"are not available to {python_executable}.{suffix}"
    )


def start_launcher(workspace_root: str | Path) -> LauncherRecord:
    workspace_root = Path(workspace_root).resolve()
    launcher_dir = get_launcher_dir()
    launcher_src = launcher_dir / "src"
    port = find_available_port()
    env = os.environ.copy()
    pythonpath_entries = [str(launcher_src)]
    if env.get("PYTHONPATH"):
        pythonpath_entries.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(pythonpath_entries)
    python_executable = env.get("ROBOTICK_HUB_PYTHON_EXECUTABLE") or sys.executable
    ensure_launcher_runtime_available(python_executable, env)
    log_dir = workspace_root / ".robotick" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "robotick-launcher.log"
    with open(log_path, "a", encoding="utf-8") as log_handle:
        child = subprocess.Popen(
            [python_executable, "-m", "robotick.launcher.cli", "listen", "--port", str(port)],
            cwd=workspace_root,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )
    return write_launcher_record(
        workspace_root,
        endpoint=f"http://127.0.0.1:{port}",
        pid=child.pid,
        python_executable=python_executable,
    )


def ensure_launcher(workspace_root: str | Path) -> LauncherRecord:
    record = discover_launcher(workspace_root)
    if record is not None and is_pid_alive(record.pid) and is_launcher_healthy(record):
        return record
    if record is not None and record.pid is not None:
        stop_launcher_process(record.pid)
        remove_launcher_record(workspace_root)

    record = start_launcher(workspace_root)
    started_at = time.time()
    while time.time() - started_at < 8:
        if record is not None and is_pid_alive(record.pid) and is_launcher_healthy(record):
            return record
        record = discover_launcher(workspace_root)
        time.sleep(0.1)
    raise RuntimeError("robotick-launcher did not become ready.")


def stop_launcher(workspace_root: str | Path) -> dict[str, Any]:
    record = discover_launcher(workspace_root)
    if record is None:
        return {
            "capability_status": "stopped",
            "endpoint": None,
            "pid": None,
            "listener_status": None,
        }

    if is_pid_alive(record.pid):
        try:
            post_launcher_json(record, "/launcher/stop")
        except RuntimeError:
            pass
        stop_launcher_process(record.pid)
    remove_launcher_record(workspace_root)
    return {
        "capability_status": "stopped",
        "endpoint": record.endpoint,
        "pid": record.pid,
        "listener_status": None,
    }


def get_launcher_status(workspace_root: str | Path) -> dict[str, Any]:
    record = discover_launcher(workspace_root)
    if record is None:
        return {
            "capability_status": "stopped",
            "endpoint": None,
            "pid": None,
            "listener_status": None,
        }

    if not is_pid_alive(record.pid):
        remove_launcher_record(workspace_root)
        return {
            "capability_status": "stale",
            "endpoint": record.endpoint,
            "pid": record.pid,
            "listener_status": None,
        }

    try:
        listener_status = fetch_launcher_json(record, "/launcher/status")
    except RuntimeError:
        return {
            "capability_status": "degraded",
            "endpoint": record.endpoint,
            "pid": record.pid,
            "listener_status": None,
        }

    return {
        "capability_status": "healthy",
        "endpoint": record.endpoint,
        "pid": record.pid,
        "listener_status": listener_status,
    }
