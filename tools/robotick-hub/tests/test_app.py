from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from robotick_hub.app import create_app
from robotick_hub.launcher import LauncherRecord
from robotick_hub.runtime import get_hub_record_path
from robotick_hub.tray import get_bundled_icon_path, should_use_tray


def create_fake_workspace() -> Path:
    root = Path(tempfile.mkdtemp(prefix="robotick-hub-test-"))
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
                "  pip-e:",
                "    project_dir: robots/pip-e",
                "    launch_script: robots/pip-e/run-studio.sh",
            ]
        ),
        encoding="utf-8",
    )
    return root


def build_client(workspace: Path) -> TestClient:
    os.environ["ROBOTICK_WORKSPACE_ROOT"] = str(workspace)
    os.environ["ROBOTICK_HUB_HOST"] = "127.0.0.1"
    os.environ["ROBOTICK_HUB_PORT"] = "7099"
    return TestClient(create_app())


def test_health_and_registry_record() -> None:
    workspace = create_fake_workspace()
    with build_client(workspace) as client:
        response = client.get("/v1/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        assert response.json()["tray_expected"] is False
        assert response.json()["tray_active"] is False
        assert get_hub_record_path(workspace).exists()
    assert not get_hub_record_path(workspace).exists()


def test_capabilities_endpoint() -> None:
    workspace = create_fake_workspace()
    with build_client(workspace) as client:
        response = client.get("/v1/capabilities")
        assert response.status_code == 200
        names = [item["name"] for item in response.json()["capabilities"]]
        assert names == ["workspace", "studio", "launcher"]


def test_capabilities_reflect_launcher_provider_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()

    monkeypatch.setattr(
        "robotick_hub.app.get_launcher_status",
        lambda _: {
            "capability_status": "healthy",
            "endpoint": "http://127.0.0.1:7081",
            "pid": 1234,
            "listener_status": {"status": "stopped"},
        },
    )

    with build_client(workspace) as client:
        response = client.get("/v1/capabilities")
        assert response.status_code == 200
        launcher = next(
            item for item in response.json()["capabilities"] if item["name"] == "launcher"
        )
        assert launcher["status"] == "healthy"
        assert launcher["endpoint"] == "http://127.0.0.1:7081"


def test_workspace_and_studio_projects_endpoints() -> None:
    workspace = create_fake_workspace()
    with build_client(workspace) as client:
        workspace_response = client.get("/v1/workspace/projects")
        studio_response = client.get("/v1/studio/projects")
        assert workspace_response.status_code == 200
        assert studio_response.status_code == 200
        workspace_names = [item["name"] for item in workspace_response.json()["projects"]]
        studio_names = [item["name"] for item in studio_response.json()["projects"]]
        assert workspace_names == ["barr-e", "pip-e"]
        assert studio_names == ["barr-e", "pip-e"]
        assert studio_response.json()["selected_target_project"] is None


def test_launcher_ensure_and_status_endpoints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()

    monkeypatch.setattr(
        "robotick_hub.app.ensure_launcher",
        lambda _: LauncherRecord(
            endpoint="http://127.0.0.1:7081",
            pid=2222,
            workspace_root=str(workspace),
        ),
    )
    monkeypatch.setattr(
        "robotick_hub.app.get_launcher_status",
        lambda _: {
            "capability_status": "healthy",
            "endpoint": "http://127.0.0.1:7081",
            "pid": 2222,
            "listener_status": {"status": "stopped", "phase": None, "profile": None, "models": {}},
        },
    )
    monkeypatch.setattr(
        "robotick_hub.app.stop_launcher",
        lambda _: {
            "capability_status": "stopped",
            "endpoint": "http://127.0.0.1:7081",
            "pid": 2222,
            "listener_status": None,
        },
    )

    with build_client(workspace) as client:
        ensure_response = client.post("/v1/capabilities/launcher/ensure")
        status_response = client.get("/v1/launcher/status")
        stop_response = client.post("/v1/launcher/stop")
        assert ensure_response.status_code == 200
        assert ensure_response.json()["capability_status"] == "healthy"
        assert ensure_response.json()["endpoint"] == "http://127.0.0.1:7081"
        assert status_response.status_code == 200
        assert status_response.json()["capability_status"] == "healthy"
        assert status_response.json()["listener_status"]["status"] == "stopped"
        assert stop_response.status_code == 200
        assert stop_response.json()["capability_status"] == "stopped"


def test_should_use_tray_defaults_to_headless_without_desktop(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    monkeypatch.delenv("ROBOTICK_HUB_FORCE_HEADLESS", raising=False)
    monkeypatch.delenv("ROBOTICK_HUB_FORCE_TRAY", raising=False)
    assert should_use_tray() is False


def test_should_use_tray_honors_force_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.setenv("ROBOTICK_HUB_FORCE_HEADLESS", "1")
    assert should_use_tray() is False
    monkeypatch.setenv("ROBOTICK_HUB_FORCE_HEADLESS", "0")
    monkeypatch.setenv("ROBOTICK_HUB_FORCE_TRAY", "1")
    assert should_use_tray() is True


def test_bundled_icon_path_exists() -> None:
    icon_path = get_bundled_icon_path()
    assert icon_path.name == "robotick-icon.png"
    assert icon_path.exists()
