from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from robotick_hub.launcher import LauncherRecord, ensure_launcher, get_launcher_status, stop_launcher


def create_workspace() -> Path:
    root = Path(tempfile.mkdtemp(prefix="robotick-launcher-provider-test-"))
    (root / ".robotick").mkdir(parents=True, exist_ok=True)
    return root


def test_ensure_launcher_reuses_healthy_record(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = create_workspace()
    record = LauncherRecord(endpoint="http://127.0.0.1:7081", pid=1234)

    monkeypatch.setattr("robotick_hub.launcher.discover_launcher", lambda _: record)
    monkeypatch.setattr("robotick_hub.launcher.is_pid_alive", lambda pid: pid == 1234)
    monkeypatch.setattr("robotick_hub.launcher.is_launcher_healthy", lambda current: current is record)

    started = {"count": 0}

    def fail_start(_: str | Path) -> LauncherRecord:
        started["count"] += 1
        return record

    monkeypatch.setattr("robotick_hub.launcher.start_launcher", fail_start)

    ensured = ensure_launcher(workspace)
    assert ensured is record
    assert started["count"] == 0


def test_ensure_launcher_restarts_stale_record(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = create_workspace()
    stale = LauncherRecord(endpoint="http://127.0.0.1:7081", pid=1111)
    healthy = LauncherRecord(endpoint="http://127.0.0.1:7082", pid=2222)
    seen = {"count": 0}

    def fake_discover(_: str | Path) -> LauncherRecord | None:
        seen["count"] += 1
        if seen["count"] == 1:
            return stale
        return healthy

    monkeypatch.setattr("robotick_hub.launcher.discover_launcher", fake_discover)
    monkeypatch.setattr("robotick_hub.launcher.is_pid_alive", lambda pid: pid == 2222)
    monkeypatch.setattr("robotick_hub.launcher.is_launcher_healthy", lambda current: current.pid == 2222)

    stopped_pids: list[int | None] = []
    monkeypatch.setattr("robotick_hub.launcher.stop_launcher_process", lambda pid: stopped_pids.append(pid))
    monkeypatch.setattr("robotick_hub.launcher.remove_launcher_record", lambda _: None)
    monkeypatch.setattr("robotick_hub.launcher.start_launcher", lambda _: healthy)

    ensured = ensure_launcher(workspace)
    assert ensured is healthy
    assert stopped_pids == [1111]


def test_get_launcher_status_reports_stopped_without_record(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = create_workspace()
    monkeypatch.setattr("robotick_hub.launcher.discover_launcher", lambda _: None)
    status = get_launcher_status(workspace)
    assert status["capability_status"] == "stopped"
    assert status["endpoint"] is None


def test_get_launcher_status_reports_listener_state(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = create_workspace()
    record = LauncherRecord(endpoint="http://127.0.0.1:7081", pid=3333)
    monkeypatch.setattr("robotick_hub.launcher.discover_launcher", lambda _: record)
    monkeypatch.setattr("robotick_hub.launcher.is_pid_alive", lambda pid: pid == 3333)
    monkeypatch.setattr(
        "robotick_hub.launcher.fetch_launcher_json",
        lambda current, path: {"status": "launching", "phase": "build"} if current is record and path == "/launcher/status" else {},
    )

    status = get_launcher_status(workspace)
    assert status["capability_status"] == "healthy"
    assert status["listener_status"]["status"] == "launching"


def test_stop_launcher_stops_managed_process_and_clears_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_workspace()
    record = LauncherRecord(endpoint="http://127.0.0.1:7081", pid=4444)
    monkeypatch.setattr("robotick_hub.launcher.discover_launcher", lambda _: record)
    monkeypatch.setattr("robotick_hub.launcher.is_pid_alive", lambda pid: pid == 4444)

    calls: list[tuple[str, object]] = []
    monkeypatch.setattr(
        "robotick_hub.launcher.post_launcher_json",
        lambda current, path: calls.append((path, current.pid)) or {"status": "stopping"},
    )
    monkeypatch.setattr("robotick_hub.launcher.stop_launcher_process", lambda pid: calls.append(("kill", pid)))
    monkeypatch.setattr("robotick_hub.launcher.remove_launcher_record", lambda _: calls.append(("remove", None)))

    status = stop_launcher(workspace)
    assert status["capability_status"] == "stopped"
    assert calls == [("/launcher/stop", 4444), ("kill", 4444), ("remove", None)]
