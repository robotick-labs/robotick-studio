from fastapi.testclient import TestClient

from robotick.launcher.listen.listener import create_app
from robotick.launcher.listen import routes_launch


def _client() -> TestClient:
    return TestClient(create_app())


def test_stop_clears_stale_launcher_status_snapshot(monkeypatch) -> None:
    monkeypatch.setattr(routes_launch, "process_handle", None)
    monkeypatch.setattr(routes_launch, "status_queue", None)
    monkeypatch.setattr(routes_launch, "status_thread", None)
    monkeypatch.setattr(routes_launch, "current_profile", None)
    monkeypatch.setattr(routes_launch, "current_project_path", None)
    monkeypatch.setattr(routes_launch, "current_run_started_at", None)
    monkeypatch.setattr(routes_launch, "log_loop", None)
    routes_launch.current_status.clear()
    routes_launch.current_status.update(
        {
            "status": "stopped",
            "phase": "run",
            "profile": "native:ALL",
            "models": {"sample-robot-face": {"stage": "run", "status": "running"}},
        }
    )

    client = _client()
    response = client.post("/launcher/stop")

    assert response.status_code == 200
    assert response.json() == {"status": "stopped"}
    assert client.get("/launcher/status").json() == {
        "status": "stopped",
        "phase": None,
        "profile": None,
        "models": {},
    }


def test_format_elapsed_since_run_start(monkeypatch) -> None:
    monkeypatch.setattr(routes_launch, "current_run_started_at", 100.0)
    monkeypatch.setattr(routes_launch.time, "monotonic", lambda: 181.2)

    assert routes_launch._format_elapsed_since_run_start() == "00:01:21.200"


def test_broadcast_log_includes_elapsed_prefix(monkeypatch) -> None:
    sent_messages: list[str] = []

    class FakeLoop:
        def call_soon_threadsafe(self, callback, *args):
            callback(*args)

    monkeypatch.setattr(routes_launch, "current_profile", "native:ALL")
    monkeypatch.setattr(routes_launch, "current_run_started_at", 100.0)
    monkeypatch.setattr(routes_launch.time, "monotonic", lambda: 181.2)
    monkeypatch.setattr(
        routes_launch,
        "datetime",
        type(
            "FakeDateTime",
            (),
            {"now": staticmethod(lambda: type("FakeNow", (), {"strftime": lambda self, _: "13:54:27.140000"})())},
        ),
    )

    queue = type("FakeQueue", (), {"put_nowait": sent_messages.append})()
    with routes_launch.log_lock:
        routes_launch.log_subscribers.append(queue)
    try:
        routes_launch._broadcast_log("hello", FakeLoop())
    finally:
        with routes_launch.log_lock:
            routes_launch.log_subscribers.clear()

    assert sent_messages == [
        f"{routes_launch.ANSI_BOLD_YELLOW}13:54:27.140{routes_launch.ANSI_RESET} | "
        f"{routes_launch.ANSI_DIM_CYAN}00:01:21.200{routes_launch.ANSI_RESET} [native:ALL] hello"
    ]


def test_run_single_model_uses_full_run_pipeline(monkeypatch, tmp_path) -> None:
    commands: list[list[str]] = []

    class FakePopen:
        pid = 1234
        stdout: list[str] = []

        def __init__(self, cmd, **kwargs):
            commands.append(cmd)

        def wait(self):
            return 0

    monkeypatch.setattr(
        routes_launch.run_profile_module,
        "_resolve_profile_model_target",
        lambda project, base_dir, platform, model_id: "linux-x64",
    )
    monkeypatch.setattr(routes_launch.subprocess, "Popen", FakePopen)
    monkeypatch.setattr(routes_launch, "current_profile", "local:demo-robot-simulator")
    monkeypatch.setattr(
        routes_launch,
        "current_project_path",
        tmp_path / "demo-robot.project.yaml",
    )
    monkeypatch.setattr(routes_launch, "current_run_started_at", 100.0)
    monkeypatch.setattr(routes_launch, "process_handle", None)
    routes_launch.current_status.clear()
    routes_launch.current_status.update(
        {
            "status": "running",
            "phase": "run",
            "profile": "local:demo-robot-simulator",
            "models": {},
        }
    )

    routes_launch._run_single_model_worker(
        tmp_path / "demo-robot.project.yaml",
        "local",
        "demo-robot-simulator",
    )

    assert commands == [
        [
            "robotick-launcher",
            "run",
            "demo-robot",
            "demo-robot-simulator",
            "linux-x64",
            "--base-dir",
            str(tmp_path),
            "--workspace-dir",
            str(tmp_path),
        ]
    ]
    assert "--no-pre" not in commands[0]
