from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import time

import pytest


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def _is_pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _terminate_pid(pid: int | None) -> None:
    if not pid:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return
    started_at = time.time()
    while time.time() - started_at < 2:
        if not _is_pid_alive(pid):
            return
        time.sleep(0.05)
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        return


def _cleanup_workspace_runtime(workspace: Path) -> None:
    robotick_dir = workspace / ".robotick"
    if not robotick_dir.exists():
        return

    for record_name in ("hub.json", "launcher.json"):
        record_path = robotick_dir / record_name
        if not record_path.exists():
            continue
        try:
            payload = json.loads(record_path.read_text(encoding="utf-8"))
        except Exception:
            payload = {}
        _terminate_pid(payload.get("pid"))
        try:
            record_path.unlink()
        except OSError:
            pass

    instances_dir = robotick_dir / "instances"
    if not instances_dir.exists():
        return
    for record_path in instances_dir.glob("*.json"):
        try:
            payload = json.loads(record_path.read_text(encoding="utf-8"))
        except Exception:
            payload = {}
        _terminate_pid(payload.get("pid"))
        try:
            record_path.unlink()
        except OSError:
            pass


def _cleanup_robotick_test_workspaces() -> None:
    temp_root = Path(tempfile.gettempdir())
    for prefix in ("robotick-cli-test-", "robotick-hub-test-"):
        for workspace in temp_root.glob(f"{prefix}*"):
            if workspace.is_dir():
                _cleanup_workspace_runtime(workspace)


@pytest.fixture(autouse=True)
def isolate_robotick_runtime(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ROBOTICK_HUB_FORCE_HEADLESS", "1")
    monkeypatch.delenv("ROBOTICK_HUB_FORCE_TRAY", raising=False)
    yield
    _cleanup_robotick_test_workspaces()
