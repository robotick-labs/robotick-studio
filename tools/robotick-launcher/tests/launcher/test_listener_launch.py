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
    monkeypatch.setattr(routes_launch, "log_loop", None)
    routes_launch.current_status.clear()
    routes_launch.current_status.update(
        {
            "status": "stopped",
            "phase": "run",
            "profile": "native:ALL",
            "models": {"alf-e-face": {"stage": "run", "status": "running"}},
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
