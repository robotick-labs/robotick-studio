from __future__ import annotations

import tempfile
from pathlib import Path
import signal

import pytest

from robotick_hub.studio import (
    StudioInstanceRecord,
    get_instance,
    list_instances,
    notify_instance_closing,
    open_studio,
    quit_instance,
    reap_instance_process_group,
    write_instance_record,
)


def create_workspace() -> Path:
    root = Path(tempfile.mkdtemp(prefix="robotick-studio-provider-test-"))
    studio_root = root / "robotick" / "robotick-studio"
    (studio_root / "tools").mkdir(parents=True, exist_ok=True)
    (root / "robotick.yaml").write_text(
        "\n".join(
            [
                "schema_version: 1",
                "",
                "studio:",
                "  default_path: robotick/robotick-studio",
                "  default_mode: dev",
                "",
                "projects:",
                "  barr-e:",
                "    project_dir: robots/barr-e",
                "    launch_script: robots/barr-e/run-studio.sh",
            ]
        ),
        encoding="utf-8",
    )
    runner = studio_root / "run-studio-dev.sh"
    runner.write_text("#!/usr/bin/env bash\nsleep 30\n", encoding="utf-8")
    runner.chmod(0o755)
    project_runner = root / "robots" / "barr-e" / "run-studio.sh"
    project_runner.parent.mkdir(parents=True, exist_ok=True)
    project_runner.write_text("#!/usr/bin/env bash\nsleep 30\n", encoding="utf-8")
    project_runner.chmod(0o755)
    return root


def test_open_studio_registers_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = create_workspace()
    monkeypatch.setenv("ROBOTICK_HUB_PORT", "7099")
    monkeypatch.setenv("ROBOTICK_HUB_HOST", "127.0.0.1")
    monkeypatch.setattr("robotick_hub.studio.ensure_launcher", lambda _: None)

    class FakeChild:
        pid = 1234

    monkeypatch.setattr("robotick_hub.studio.subprocess.Popen", lambda *args, **kwargs: FakeChild())
    monkeypatch.setattr("robotick_hub.studio.is_instance_alive", lambda instance: instance.pid == 1234)
    summary = open_studio(workspace, project_name="barr-e")
    assert summary["name"] == "studio-1234"
    assert summary["project_name"] == "barr-e"
    assert get_instance(workspace, "studio-1234") is not None


def test_list_instances_cleans_stale_records(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = create_workspace()
    record = StudioInstanceRecord(
        name="studio-2222",
        pid=2222,
        mode="dev",
        project_name=None,
        started_at="2026-06-06T12:00:00+00:00",
    )
    write_instance_record(workspace, record)
    monkeypatch.setattr("robotick_hub.studio.is_instance_alive", lambda instance: False)
    assert list_instances(workspace) == []
    assert get_instance(workspace, "studio-2222") is None


def test_quit_instance_prefers_signal_fallback_when_no_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_workspace()
    record = StudioInstanceRecord(
        name="studio-3333",
        pid=3333,
        mode="dev",
        project_name="barr-e",
        started_at="2026-06-06T12:00:00+00:00",
    )
    write_instance_record(workspace, record)
    signals: list[int] = []
    monkeypatch.setattr("robotick_hub.studio.signal_instance_process_tree", lambda pid, sig: signals.append(pid))
    monkeypatch.setattr("robotick_hub.studio.wait_for_instance_exit", lambda pid, timeout_ms: True)
    accepted, message, instance = quit_instance(workspace, "studio-3333")
    assert accepted is True
    assert "closed" in message
    assert instance is not None
    assert signals == [3333]


def test_list_instances_reaps_stale_dev_stack_without_ui(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_workspace()
    record = StudioInstanceRecord(
        name="studio-4444",
        pid=4444,
        mode="dev",
        project_name=None,
        started_at="2026-06-06T12:00:00+00:00",
    )
    write_instance_record(workspace, record)
    monkeypatch.setattr(
        "robotick_hub.studio.list_unix_process_group_processes",
        lambda _pid: [
            {"pid": 4444, "pgid": 4444, "args": "bash run-studio-dev.sh"},
            {"pid": 4445, "pgid": 4444, "args": "node concurrently"},
            {"pid": 4446, "pgid": 4444, "args": "vite"},
        ],
    )
    signals: list[tuple[int, signal.Signals]] = []
    monkeypatch.setattr(
        "robotick_hub.studio.signal_instance_process_tree",
        lambda pid, sig: signals.append((pid, sig)),
    )
    monkeypatch.setattr(
        "robotick_hub.studio.wait_for_instance_exit",
        lambda pid, timeout_ms: True,
    )

    assert list_instances(workspace) == []
    assert signals == [(4444, signal.SIGTERM)]
    assert get_instance(workspace, "studio-4444") is None


def test_reap_instance_process_group_escalates_when_needed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = StudioInstanceRecord(
        name="studio-5555",
        pid=5555,
        mode="dev",
        project_name=None,
        started_at="2026-06-06T12:00:00+00:00",
    )
    monkeypatch.setattr(
        "robotick_hub.studio.list_unix_process_group_members",
        lambda _pid: [5555, 5556],
    )
    signals: list[tuple[int, signal.Signals]] = []
    monkeypatch.setattr(
        "robotick_hub.studio.signal_instance_process_tree",
        lambda pid, sig: signals.append((pid, sig)),
    )
    waits = iter([False, True])
    monkeypatch.setattr(
        "robotick_hub.studio.wait_for_instance_exit",
        lambda pid, timeout_ms: next(waits),
    )

    reap_instance_process_group(record)

    assert signals == [(5555, signal.SIGTERM), (5555, signal.SIGKILL)]


def test_notify_instance_closing_matches_process_member(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_workspace()
    record = StudioInstanceRecord(
        name="studio-6666",
        pid=6666,
        mode="dev",
        project_name=None,
        started_at="2026-06-06T12:00:00+00:00",
    )
    write_instance_record(workspace, record)
    monkeypatch.setattr(
        "robotick_hub.studio.list_unix_process_group_members",
        lambda pid: [6666, 7777] if pid == 6666 else [],
    )

    accepted, message, instance = notify_instance_closing(
        workspace,
        app_id="studio",
        process_id=7777,
    )

    assert accepted is True
    assert "marked closing" in message
    assert instance is not None
    assert instance["name"] == "studio-6666"


def test_notify_instance_closing_by_instance_name() -> None:
    workspace = create_workspace()
    record = StudioInstanceRecord(
        name="studio-7777",
        pid=7777,
        mode="dev",
        project_name=None,
        started_at="2026-06-06T12:00:00+00:00",
    )
    write_instance_record(workspace, record)

    accepted, message, instance = notify_instance_closing(
        workspace,
        app_id="studio",
        instance_name="studio-7777",
    )

    assert accepted is True
    assert "marked closing" in message
    assert instance is not None
    assert instance["name"] == "studio-7777"
    assert get_instance(workspace, "studio-7777") is None
