from __future__ import annotations

from contextlib import contextmanager
import os
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from robotick_hub.app import create_app
from robotick_hub.launcher import LauncherRecord
from robotick_hub.runtime import get_hub_record_path
from robotick_hub.studio import StudioInstanceRecord, write_instance_record
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
                "  pip-e:",
                "    project_dir: robots/pip-e",
            ]
        ),
        encoding="utf-8",
    )
    return root


@contextmanager
def build_client(workspace: Path):
    previous = {
        "ROBOTICK_WORKSPACE_ROOT": os.environ.get("ROBOTICK_WORKSPACE_ROOT"),
        "ROBOTICK_HUB_HOST": os.environ.get("ROBOTICK_HUB_HOST"),
        "ROBOTICK_HUB_PORT": os.environ.get("ROBOTICK_HUB_PORT"),
    }
    os.environ["ROBOTICK_WORKSPACE_ROOT"] = str(workspace)
    os.environ["ROBOTICK_HUB_HOST"] = "127.0.0.1"
    os.environ["ROBOTICK_HUB_PORT"] = "7099"
    try:
        with TestClient(create_app()) as client:
            yield client
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_health_and_registry_record() -> None:
    workspace = create_fake_workspace()
    with build_client(workspace) as client:
        response = client.get("/v1/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        assert response.json()["api_version"] == 1
        assert "studio_project_select" in response.json()["features"]
        assert "studio_activation" in response.json()["features"]
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
        assert names == [
            "query-workspace-config",
            "launch-studio",
            "query-launcher-status",
            "ensure-launcher-service",
        ]


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
        query_launcher = next(
            item
            for item in response.json()["capabilities"]
            if item["name"] == "query-launcher-status"
        )
        ensure_launcher = next(
            item
            for item in response.json()["capabilities"]
            if item["name"] == "ensure-launcher-service"
        )
        assert query_launcher["status"] == "available"
        assert ensure_launcher["status"] == "available"


def test_workspace_and_studio_projects_endpoints() -> None:
    workspace = create_fake_workspace()
    (workspace / "robots" / "barr-e").mkdir(parents=True)
    (workspace / "robots" / "pip-e").mkdir(parents=True)
    (workspace / "robots" / "barr-e" / "barr-e.project.yaml").write_text(
        'name: "Barr.e"\ndescription: "Barr project."\n',
        encoding="utf-8",
    )
    (workspace / "robots" / "pip-e" / "pip-e.project.yaml").write_text(
        'name: "Pip.e"\n',
        encoding="utf-8",
    )
    with build_client(workspace) as client:
        workspace_response = client.get("/v1/workspace/projects")
        studio_response = client.get("/v1/studio/projects")
        assert workspace_response.status_code == 200
        assert studio_response.status_code == 200
        workspace_names = [item["name"] for item in workspace_response.json()["projects"]]
        studio_names = [item["name"] for item in studio_response.json()["projects"]]
        assert workspace_names == ["barr-e", "pip-e"]
        assert studio_names == ["barr-e", "pip-e"]
        assert workspace_response.json()["projects"][0]["project_path"].endswith(
            "/robots/barr-e/barr-e.project.yaml"
        )
        assert workspace_response.json()["projects"][0]["display_name"] == "Barr.e"
        assert workspace_response.json()["projects"][0]["description"] == "Barr project."
        assert studio_response.json()["selected_target_project"] is None


def test_workspace_query_endpoints_without_launcher() -> None:
    workspace = create_fake_workspace()
    (workspace / "robots" / "barr-e").mkdir(parents=True)
    (workspace / "robots" / "barr-e" / "assets").mkdir(parents=True)
    (workspace / "robots" / "barr-e" / "barr-e.project.yaml").write_text(
        'name: "Barr.e"\ndescription: "Barr project."\n',
        encoding="utf-8",
    )
    (workspace / "robots" / "barr-e" / "barr-e.rc.yaml").write_text(
        "camera:\n  enabled: true\n",
        encoding="utf-8",
    )
    (workspace / "robots" / "barr-e" / "brain.model.yaml").write_text(
        'name: "Barr Brain"\n',
        encoding="utf-8",
    )
    (workspace / "robots" / "barr-e" / "assets" / "demo.txt").write_text(
        "hello",
        encoding="utf-8",
    )
    project_path = str(workspace / "robots" / "barr-e" / "barr-e.project.yaml")
    with build_client(workspace) as client:
        assert client.get("/query/list-projects").json() == [project_path]
        assert client.get("/query/get-project-settings", params={"project_path": project_path}).json()[
            "name"
        ] == "Barr.e"
        assert client.get(
            "/query/get-project-rc-settings", params={"project_path": project_path}
        ).json()["camera"]["enabled"] is True
        assert client.get("/query/list-project-models", params={"project_path": project_path}).json() == [
            "brain.model.yaml"
        ]
        assert client.get(
            "/query/get-model",
            params={"project_path": project_path, "model_path": "brain.model.yaml"},
        ).json()["name"] == "Barr Brain"
        asset_response = client.get(
            "/query/project-assets/assets/demo.txt",
            params={"project_path": project_path},
        )
        assert asset_response.status_code == 200
        assert asset_response.text == "hello"


def test_workspace_query_endpoints_reject_unregistered_project_paths() -> None:
    workspace = create_fake_workspace()
    (workspace / "robots" / "barr-e").mkdir(parents=True)
    (workspace / "robots" / "barr-e" / "barr-e.project.yaml").write_text(
        'name: "Barr.e"\n',
        encoding="utf-8",
    )
    rogue_project = workspace / "tmp" / "rogue.project.yaml"
    rogue_project.parent.mkdir(parents=True)
    rogue_project.write_text('name: "Rogue"\n', encoding="utf-8")

    with build_client(workspace) as client:
        settings_response = client.get(
            "/query/get-project-settings",
            params={"project_path": str(rogue_project)},
        )
        models_response = client.get(
            "/query/list-project-models",
            params={"project_path": str(rogue_project)},
        )
        assert settings_response.status_code == 404
        assert models_response.status_code == 404
        assert "not registered in this workspace" in settings_response.json()["detail"]


def test_launcher_proxy_routes_delegate_to_launcher(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr(
        "robotick_hub.app.ensure_launcher",
        lambda _: LauncherRecord(
            endpoint="http://127.0.0.1:7081",
            pid=4321,
            workspace_root=str(workspace),
        ),
    )
    monkeypatch.setattr(
        "robotick_hub.app.proxy_launcher_request",
        lambda _record, _method, _path, **_kwargs: (
            200,
            b'{"status":"ok"}',
            {"Content-Type": "application/json"},
        ),
    )
    with build_client(workspace) as client:
        status_response = client.get("/launcher/status")
        run_response = client.post(
            "/launcher/run",
            params={"project_path": "/tmp/demo.project.yaml", "profile": "local:ALL"},
        )
        workloads_response = client.get(
            "/query/get-workloads-registry",
            params={"project_path": "/tmp/demo.project.yaml", "target": "linux"},
        )
        assert status_response.status_code == 200
        assert status_response.json()["status"] == "ok"
        assert run_response.status_code == 200
        assert run_response.json()["status"] == "ok"
        assert workloads_response.status_code == 200
        assert workloads_response.json()["status"] == "ok"


def test_hub_allows_localhost_and_null_cors_origins() -> None:
    workspace = create_fake_workspace()
    with build_client(workspace) as client:
        localhost_response = client.get(
            "/v1/health",
            headers={"Origin": "http://localhost:5173"},
        )
        null_response = client.get(
            "/v1/health",
            headers={"Origin": "null"},
        )
        assert localhost_response.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert null_response.headers["access-control-allow-origin"] == "null"


def test_studio_projects_can_reflect_selected_target_project(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr(
        "robotick_hub.app.get_instance",
        lambda _workspace, instance_id: {
            "name": instance_id,
            "pid": 1234,
            "mode": "dev",
            "started_at": "2026-06-06T12:00:00+00:00",
            "state": "running",
            "project_name": "barr-e",
            "log_path": None,
            "control_endpoint": None,
        },
    )
    with build_client(workspace) as client:
        studio_response = client.get("/v1/studio/projects?instance_id=studio-1234")
        assert studio_response.status_code == 200
        assert studio_response.json()["selected_target_project"] == "barr-e"


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


def test_studio_instances_open_and_quit_endpoints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    summary = {
        "name": "studio-1234",
        "pid": 1234,
        "mode": "dev",
        "started_at": "2026-06-06T12:00:00+00:00",
        "state": "running",
        "project_name": "barr-e",
        "log_path": "/tmp/studio.log",
        "control_endpoint": None,
    }
    monkeypatch.setattr("robotick_hub.app.list_instances", lambda _: [summary])
    monkeypatch.setattr(
        "robotick_hub.app.open_studio",
        lambda _, project_name=None: (summary, {"launcher_service": {"action": "started"}}),
    )
    monkeypatch.setattr(
        "robotick_hub.app.quit_instance",
        lambda _, instance_id: (True, f"Studio instance {instance_id} closed.", summary),
    )
    with build_client(workspace) as client:
        instances_response = client.get("/v1/studio/instances")
        open_response = client.post("/v1/studio/open", json={"project_name": "barr-e"})
        quit_response = client.post("/v1/studio/instances/studio-1234/quit")
        assert instances_response.status_code == 200
        assert instances_response.json()["resource_type"] == "robotick_studio_instances"
        assert instances_response.json()["instances"][0]["name"] == "studio-1234"
        assert open_response.status_code == 200
        assert open_response.json()["instance"]["project_name"] == "barr-e"
        assert open_response.json()["support"]["launcher_service"]["action"] == "started"
        assert quit_response.status_code == 200
        assert quit_response.json()["accepted"] is True


def test_studio_instance_status_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    status_payload = {
        "resource_type": "studio_instance",
        "id": "studio-1234",
        "name": "studio-1234",
        "pid": 1234,
        "mode": "dev",
        "started_at": "2026-06-06T12:00:00+00:00",
        "state": "running",
        "project_name": "barr-e",
        "control_endpoint": None,
        "children": {
            "windows": [
                {
                    "resource_type": "studio_window",
                    "id": "main",
                    "label": "Main Window",
                    "window_role": "main",
                }
            ]
        },
        "child_collections": [{"name": "windows", "resource_type": "studio_windows", "item_count": 1}],
    }
    monkeypatch.setattr(
        "robotick_hub.app.get_studio_status",
        lambda _, instance_id, path_segments=(): (
            status_payload if instance_id == "studio-1234" and path_segments == () else None
        ),
    )
    with build_client(workspace) as client:
        response = client.get("/v1/studio/instances/studio-1234/status")
        assert response.status_code == 200
        assert response.json()["resource_type"] == "studio_instance"
        assert response.json()["children"]["windows"][0]["id"] == "main"
        assert response.json()["child_collections"][0]["name"] == "windows"


def test_studio_control_endpoint_registration_updates_instance_record() -> None:
    workspace = create_fake_workspace()
    write_instance_record(
        workspace,
        StudioInstanceRecord(
            name="studio-1234",
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
        ),
    )

    with build_client(workspace) as client:
        response = client.post(
            "/v1/studio/instances/studio-1234/control-endpoint",
            json={"endpoint": "http://127.0.0.1:7123"},
        )

    assert response.status_code == 200
    assert response.json()["accepted"] is True
    assert response.json()["instance"]["control_endpoint"] == "http://127.0.0.1:7123"


def test_studio_status_prefers_registered_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    write_instance_record(
        workspace,
        StudioInstanceRecord(
            name="studio-1234",
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return b'{"resource_type":"studio_instance","id":"studio-1234","state":"runtime"}'

    monkeypatch.setattr("robotick_hub.studio.urlopen", lambda url, timeout: FakeResponse())

    with build_client(workspace) as client:
        response = client.get("/v1/studio/instances/studio-1234/status")

    assert response.status_code == 200
    assert response.json()["state"] == "runtime"


def test_studio_project_select_proxies_to_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    write_instance_record(
        workspace,
        StudioInstanceRecord(
            name="studio-1234",
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )
    captured: dict[str, object] = {}

    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return b'{"accepted":true,"currentProjectPath":"/tmp/barr-e.project.yaml","issue":null}'

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["body"] = request.data.decode("utf-8")
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr("robotick_hub.studio.urlopen", fake_urlopen)

    with build_client(workspace) as client:
        response = client.post(
            "/v1/studio/instances/studio-1234/project/select",
            json={"project_path": "/tmp/barr-e.project.yaml"},
        )

    assert response.status_code == 200
    assert response.json()["accepted"] is True
    assert captured["url"] == "http://127.0.0.1:7123/v1/project/select"
    assert '"project_path": "/tmp/barr-e.project.yaml"' in captured["body"]


def test_studio_activation_proxies_to_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    write_instance_record(
        workspace,
        StudioInstanceRecord(
            name="studio-1234",
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )
    captured: dict[str, object] = {}

    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return (
                b'{"accepted":true,"changed":true,'
                b'"activated_path":["windows","main"],'
                b'"previous_active_path":null,'
                b'"message":"Activated Studio resource."}'
            )

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["body"] = request.data.decode("utf-8")
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr("robotick_hub.studio.urlopen", fake_urlopen)

    with build_client(workspace) as client:
        response = client.post(
            "/v1/studio/instances/studio-1234/windows/main/activate",
        )

    assert response.status_code == 200
    assert response.json()["accepted"] is True
    assert response.json()["activated_path"] == ["windows", "main"]
    assert captured["url"] == "http://127.0.0.1:7123/v1/studio/windows/main/activate"
    assert captured["body"] == "{}"


def test_app_instance_closing_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    summary = {
        "name": "studio-1234",
        "pid": 1234,
        "mode": "dev",
        "started_at": "2026-06-06T12:00:00+00:00",
        "state": "running",
        "project_name": None,
        "log_path": None,
        "control_endpoint": None,
    }
    monkeypatch.setattr(
        "robotick_hub.app.notify_instance_closing",
        lambda *_args, **_kwargs: (True, "Studio instance studio-1234 marked closing.", summary),
    )
    with build_client(workspace) as client:
        response = client.post("/v1/apps/studio/instances/closing", json={"pid": 1234})
        assert response.status_code == 200
        assert response.json()["accepted"] is True
        assert response.json()["instance"]["name"] == "studio-1234"


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
