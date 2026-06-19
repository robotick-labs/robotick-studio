from __future__ import annotations

from contextlib import contextmanager
import importlib
import os
import signal
import tempfile
import threading
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError, URLError

from fastapi.testclient import TestClient
import pytest

from robotick_hub.app import create_app
from robotick_hub.runtime import get_hub_record_path
from robotick_hub.tray import get_bundled_icon_path, should_use_tray
from robotick.studio_ability.domain import StudioInstanceRecord, write_instance_record


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


class FakeWorkerProcess:
    def __init__(self, pid: int, returncode: int = 0, on_wait=None):
        self.pid = pid
        self._returncode = returncode
        self._on_wait = on_wait

    def wait(self) -> int:
        if self._on_wait is not None:
            self._on_wait(self.pid)
        return self._returncode


def models_by_id(payload: dict) -> dict[str, dict]:
    return {
        model["model_id"]: model
        for model in payload.get("models", [])
    }


def project_yaml(name: str, models: list[str], extra_lines: list[str] | None = None) -> str:
    lines = [f"name: {name}", "models:"]
    lines.extend(f"  - {model}.model.yaml" for model in models)
    if extra_lines:
        lines.extend(extra_lines)
    return "\n".join(lines) + "\n"


def test_health_and_registry_record() -> None:
    workspace = create_fake_workspace()
    with build_client(workspace) as client:
        response = client.get("/v1/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        assert response.json()["api_version"] == 1
        assert "studio_project_select" in response.json()["features"]
        assert "studio_activation" in response.json()["features"]
        assert "launcher_groups" not in response.json()["features"]
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


def test_ability_registry_and_status_endpoints() -> None:
    workspace = create_fake_workspace()
    with build_client(workspace) as client:
        abilities = client.get("/v1/abilities")
        launcher_status = client.get("/v1/abilities/launcher/status")
        studio_status = client.get("/v1/abilities/studio/status")

        assert abilities.status_code == 200
        assert [item["name"] for item in abilities.json()["abilities"]] == ["studio", "launcher"]
        assert launcher_status.status_code == 200
        assert launcher_status.json()["name"] == "launcher"
        assert studio_status.status_code == 200
        assert studio_status.json()["name"] == "studio"


def test_launcher_stop_worker_entrypoint_imports_without_ability_cycle() -> None:
    module = importlib.import_module("robotick.launcher.workers.hub_launcher_worker")

    assert module.build_parser().prog == "python -m robotick.launcher.workers.hub_launcher_worker"


def test_launcher_pid_alive_treats_zombies_as_not_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robotick.launcher.hub_ability import ability

    class FakeStatPath:
        def __init__(self, _path: str):
            pass

        def exists(self) -> bool:
            return True

        def read_text(self, *, encoding: str) -> str:
            assert encoding == "utf-8"
            return "123 (python) Z 1 123 123 0 -1 0"

    monkeypatch.setattr(ability.os, "kill", lambda _pid, _signal: None)
    monkeypatch.setattr(ability, "Path", FakeStatPath)

    assert ability._pid_alive(123) is False


def test_capabilities_reflect_launcher_provider_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()

    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability.LauncherAbility.get_status",
        lambda self, _context: type(
            "FakeStatus",
            (),
            {"name": "launcher", "version": "0.1.0", "status": "available", "details": {}},
        )(),
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
        'name: "Barr.e"\ndescription: "Barr project."\nmodels:\n  - brain.model.yaml\n',
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


def test_legacy_launcher_routes_are_gone_and_query_schema_is_in_process(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    (workspace / "robots" / "barr-e").mkdir(parents=True)
    (workspace / "robots" / "barr-e" / "engine" / "schemas").mkdir(parents=True)
    project_path = workspace / "robots" / "barr-e" / "barr-e.project.yaml"
    project_path.write_text(
        "\n".join(
            [
                "models:",
                "  - brain.model.yaml",
                "runtime:",
                "  engine: ./engine",
            ]
        ),
        encoding="utf-8",
    )
    (workspace / "robots" / "barr-e" / "brain.model.yaml").write_text("name: Brain\n", encoding="utf-8")
    (workspace / "robots" / "barr-e" / "engine" / "schemas" / "core_model_envelope.schema.json").write_text(
        '{"type":"object"}\n',
        encoding="utf-8",
    )
    (workspace / "robots" / "barr-e" / "engine" / "schemas" / "workloads_layout.schema.json").write_text(
        '{"type":"object"}\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._launcher_query",
        lambda: type(
            "FakeQuery",
            (),
            {
                "build_workloads_registry": staticmethod(
                    lambda _project_path, _target: {"project": str(project_path), "target": "linux", "workloads": [], "types": [], "writable_inputs": [], "validation_errors": []}
                ),
                "get_core_model_schema": staticmethod(lambda _project_path, _target: {"type": "object"}),
            },
        )(),
    )
    with build_client(workspace) as client:
        status_response = client.get("/launcher/status")
        run_response = client.post(
            "/launcher/run",
        )
        group_create_response = client.post(
            "/v1/launcher/groups",
            json={"project_name": "barr-e", "profile": "native:ALL"},
        )
        group_response = client.get("/v1/launcher/groups/msg_demo")
        group_sessions_response = client.get("/v1/launcher/groups/msg_demo/sessions")
        group_logs_response = client.get("/v1/launcher/groups/msg_demo/logs")
        group_stop_response = client.post("/v1/launcher/groups/msg_demo/stop")
        group_restart_response = client.post("/v1/launcher/groups/msg_demo/restart")
        session_response = client.get("/v1/launcher/sessions/ms_demo")
        session_logs_response = client.get("/v1/launcher/sessions/ms_demo/logs")
        workloads_response = client.get(
            "/query/get-workloads-registry",
            params={"project_path": str(project_path), "target": "linux"},
        )
        schema_response = client.get(
            "/query/get-core-model-schema",
            params={"project_path": str(project_path), "target": "linux"},
        )
        assert status_response.status_code == 404
        assert run_response.status_code == 404
        assert group_create_response.status_code == 404
        assert group_response.status_code == 404
        assert group_sessions_response.status_code == 404
        assert group_logs_response.status_code == 404
        assert group_stop_response.status_code == 404
        assert group_restart_response.status_code == 404
        assert session_response.status_code == 404
        assert session_logs_response.status_code == 404
        assert workloads_response.status_code == 200
        assert workloads_response.json()["project"] == str(project_path)
        assert schema_response.status_code == 200
        assert schema_response.json()["type"] == "object"


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
        "robotick.studio_ability.hub_ability.ability.get_studio_status",
        lambda _workspace, instance_id: {
            "name": instance_id,
            "resource_type": "studio_instance",
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


def test_launcher_status_endpoint_reports_embedded_ability_health() -> None:
    workspace = create_fake_workspace()

    with build_client(workspace) as client:
        status_response = client.get("/v1/launcher/status")
        assert status_response.status_code == 200
        assert status_response.json()["ability"]["status"] == "available"
        assert status_response.json()["runtime"] == {
            "resource_type": "robotick_launcher_runtime_status",
            "state": "stopped",
            "models": [],
        }
        assert "groups" not in status_response.json()
        assert "sessions" not in status_response.json()


def test_launcher_runtime_endpoint_projects_live_per_model_truth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    project_dir = workspace / "robots" / "barr-e"
    project_dir.mkdir(parents=True)
    for model_name in ("healthy", "missing", "pid-live", "stopping"):
        (project_dir / f"{model_name}.model.yaml").write_text("name: Test\n", encoding="utf-8")
    (project_dir / "barr-e.project.yaml").write_text(
        project_yaml("Barr.e", ["healthy", "missing", "pid-live", "stopping"]),
        encoding="utf-8",
    )
    records = [
        {
            "project_id": "barr-e",
            "project_path": "/workspace/robots/barr-e/barr-e.project.yaml",
            "model_id": "healthy",
            "pid": 1111,
            "health_urls": ["http://localhost:7111/health"],
            "operation": {"action": "launching", "pid": 1111},
        },
        {
            "project_id": "barr-e",
            "project_path": "/workspace/robots/barr-e/barr-e.project.yaml",
            "model_id": "missing",
            "pid": 2222,
            "health_urls": ["http://localhost:7222/health"],
        },
        {
            "project_id": "barr-e",
            "project_path": "/workspace/robots/barr-e/barr-e.project.yaml",
            "model_id": "pid-live",
            "pid": 3333,
            "health_urls": ["http://localhost:7333/health"],
        },
        {
            "project_id": "barr-e",
            "project_path": "/workspace/robots/barr-e/barr-e.project.yaml",
            "model_id": "stopping",
            "pid": 4444,
            "health_urls": ["http://localhost:7444/health"],
            "operation": {"action": "stopping", "pid": 5555},
        },
        {
            "project_id": "pip-e",
            "project_path": "/workspace/robots/pip-e/pip-e.project.yaml",
            "model_id": "other-project",
            "pid": 6666,
            "health_urls": ["http://localhost:7666/health"],
        },
    ]
    for record in records:
        ability._write_runtime_phonebook_record(str(workspace), record)

    def probe(record, *, timeout=0.25):
        if record["model_id"] == "healthy":
            return {
                "configured": True,
                "healthy": True,
                "health_url": record["health_urls"][0],
                "error": None,
            }
        return {
            "configured": True,
            "healthy": False,
            "health_url": record["health_urls"][0],
            "error": "connection refused",
        }

    monkeypatch.setattr(ability, "_probe_runtime_phonebook_record", probe)
    monkeypatch.setattr(ability, "_pid_alive", lambda pid: pid in {1111, 3333, 5555})

    with build_client(workspace) as client:
        response = client.get("/v1/launcher/runtime", params={"project_id": "barr-e"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["resource_type"] == "robotick_launcher_runtime_status"
    assert payload["state"] == "pending"
    models = {model["model_id"]: model for model in payload["models"]}
    assert set(models) == {"healthy", "missing", "pid-live", "stopping"}
    assert models["healthy"]["lifecycle"] == "running"
    assert models["healthy"]["readiness"] == "ready"
    assert models["healthy"]["freshness"] == "live"
    assert models["healthy"]["operation"] is None
    assert models["missing"]["lifecycle"] == "stopped"
    assert models["missing"]["freshness"] == "stopped"
    assert models["pid-live"]["lifecycle"] == "running"
    assert models["pid-live"]["readiness"] == "failed"
    assert models["pid-live"]["freshness"] == "failed"
    assert models["stopping"]["lifecycle"] == "stopping"
    assert models["stopping"]["operation"]["action"] == "stopping"


def test_launcher_runtime_culls_phonebook_records_for_absent_models() -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    project_dir = workspace / "robots" / "pip-e"
    project_dir.mkdir(parents=True)
    (project_dir / "pip-e-face.model.yaml").write_text("name: Face\n", encoding="utf-8")
    (project_dir / "pip-e.project.yaml").write_text(
        project_yaml("Pip.e", ["pip-e-face"]),
        encoding="utf-8",
    )
    live_record = ability._write_runtime_phonebook_record(
        str(workspace),
        {
            "project_id": "pip-e",
            "project_path": str(project_dir / "pip-e.project.yaml"),
            "model_id": "pip-e-face",
        },
    )
    stale_record = ability._write_runtime_phonebook_record(
        str(workspace),
        {
            "project_id": "pip-e",
            "project_path": str(project_dir / "pip-e.project.yaml"),
            "model_id": "pip-e-brain",
        },
    )

    with build_client(workspace) as client:
        response = client.get("/v1/launcher/runtime", params={"project_id": "pip-e"})

    assert response.status_code == 200
    model_ids = [model["model_id"] for model in response.json()["models"]]
    assert model_ids == ["pip-e-face"]
    assert live_record["model_id"] == "pip-e-face"
    assert stale_record["model_id"] == "pip-e-brain"
    assert ability._runtime_phonebook_path(str(workspace), "pip-e", "pip-e-face").exists()
    assert not ability._runtime_phonebook_path(str(workspace), "pip-e", "pip-e-brain").exists()


def test_launcher_runtime_status_hydrates_blank_phonebook_from_live_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    project_dir = workspace / "robots" / "barr-e"
    project_dir.mkdir(parents=True)
    (project_dir / "brain.model.yaml").write_text("name: Brain\n", encoding="utf-8")
    (project_dir / "barr-e.project.yaml").write_text(
        project_yaml("Barr.e", ["brain"]),
        encoding="utf-8",
    )

    domain = ability._launcher_domain()
    store = ability._json_store(str(workspace))
    session = domain.ModelSessionRecord(
        group_id="msg_brain",
        project_id="barr-e",
        model_id="brain",
        lifecycle=domain.SessionLifecycle.STARTING,
        runtime={
            "worker": {
                "pid": 4242,
                "command": ["python", "-m", "robotick.launcher.cli"],
                "log_path": "/tmp/4242.log",
            },
            "probe": {
                "authority": "robotick-engine",
                "host": "127.0.0.1",
                "port": 7090,
                "telemetry_url": "http://127.0.0.1:7090/api/telemetry",
                "health_urls": ["http://127.0.0.1:7090/api/telemetry/health"],
            },
        },
    )
    store.create_session(session)
    ability._write_runtime_phonebook_record(
        str(workspace),
        {
            "project_id": "barr-e",
            "project_path": str(project_dir / "barr-e.project.yaml"),
            "model_id": "brain",
            "pid": None,
            "log_path": None,
            "telemetry_host": None,
            "telemetry_port": None,
            "telemetry_url": None,
            "health_urls": [],
            "last_session_id": session.id,
            "operation": {
                "action": "restarting",
                "pid": None,
                "started_at": ability._utc_now().isoformat(),
            },
            "last_known_runtime": {},
        },
    )

    monkeypatch.setattr(ability, "_pid_alive", lambda pid: int(pid) == 4242)
    monkeypatch.setattr(
        ability,
        "_probe_runtime_authority",
        lambda _session, timeout=0.25: {
            "configured": True,
            "healthy": True,
            "health_url": "http://127.0.0.1:7090/api/telemetry/health",
            "error": None,
            "authority": "robotick-engine",
        },
    )
    monkeypatch.setattr(
        ability,
        "_probe_runtime_phonebook_record",
        lambda record, timeout=0.25: {
            "configured": bool(record.get("health_urls")),
            "healthy": bool(record.get("health_urls")),
            "health_url": (record.get("health_urls") or [None])[0],
            "error": None if record.get("health_urls") else "runtime_probe_unconfigured",
        },
    )

    with build_client(workspace) as client:
        response = client.get("/v1/launcher/runtime", params={"project_id": "barr-e"})

    assert response.status_code == 200
    payload = response.json()
    models = models_by_id(payload)
    assert payload["state"] == "running"
    assert models["brain"]["lifecycle"] == "running"
    assert models["brain"]["readiness"] == "ready"
    assert models["brain"]["freshness"] == "live"
    assert models["brain"]["operation"] is None
    assert models["brain"]["pid"] == 4242
    assert models["brain"]["telemetry_port"] == 7090

    hydrated = ability._runtime_phonebook_record(str(workspace), "barr-e", "brain")
    assert hydrated is not None
    assert hydrated["pid"] == 4242
    assert hydrated["operation"] is None
    assert hydrated["health_urls"] == ["http://127.0.0.1:7090/api/telemetry/health"]


def test_launcher_control_launch_request_prefers_profile_when_intent_also_present() -> None:
    from robotick.launcher.hub_ability import ability

    request = ability.LauncherModelControlRequest(
        project_name="barr-e",
        profile="native:ALL",
        intent={
            "project": "barr-e",
            "scope": {"kind": "model", "value": "brain"},
            "target_policy": "native",
        },
    )

    launch_request = ability._launch_request_from_control(request)

    assert launch_request.profile == "native:ALL"
    assert launch_request.intent is None


def test_launcher_status_does_not_probe_stopped_sessions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robotick.launcher import domain
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    store = domain.LauncherSessionStore(workspace)
    intent = domain.LaunchIntent(
        project="barr-e",
        scope=domain.LaunchScope(kind=domain.ScopeKind.MODEL, value="barr-e-face"),
        target_policy=domain.TargetPolicy.LOCAL,
    )
    group = store.create_group(
        domain.ModelSessionGroupRecord(
            workspace_id="robotick-knitware",
            project_id="barr-e",
            project_path="/tmp/barr-e.project.yaml",
            intent=intent,
            resolved_model_ids=["barr-e-face"],
            status=domain.GroupStatus.STOPPED,
        )
    )
    store.create_session(
        domain.ModelSessionRecord(
            group_id=group.id,
            project_id="barr-e",
            model_id="barr-e-face",
            target=domain.TargetOverride(platform="linux"),
            lifecycle=domain.SessionLifecycle.STALE,
            readiness="stale",
            diagnostics=[
                domain.Diagnostics(
                    code="runtime_probe_stale",
                    message="stale before stop cleanup",
                )
            ],
            runtime={
                "control": {
                    "action": "stop",
                    "returncode": 0,
                },
                "stopped_at": "2026-06-11T20:00:00Z",
                "probe": {
                    "authority": "robotick-engine",
                    "configured": True,
                    "health_urls": ["http://localhost:7090/api/telemetry/health"],
                }
            },
        )
    )

    def fail_probe(*_args, **_kwargs):
        raise AssertionError("stopped sessions must not be runtime probed")

    monkeypatch.setattr("robotick.launcher.hub_ability.ability._probe_runtime_authority", fail_probe)

    ability._refresh_state(str(workspace))

    session = store.list_sessions(group_id=group.id)[0]
    assert session.lifecycle == domain.SessionLifecycle.STOPPED
    assert session.readiness == "pending"
    assert session.diagnostics == []


def test_launcher_model_controls_remain_independent_across_projects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    for project_name in ("barr-e", "pip-e"):
        project_dir = workspace / "robots" / project_name
        project_dir.mkdir(parents=True)
        (project_dir / "engine").mkdir()
        (project_dir / f"{project_name}.project.yaml").write_text(
            project_yaml(project_name, ["brain"], ["runtime:", "  engine: ./engine"]),
            encoding="utf-8",
        )
        (project_dir / "brain.model.yaml").write_text(
            "\n".join(
                [
                    "runtime:",
                    "  target_platform: linux",
                ]
            ),
            encoding="utf-8",
        )

    spawned_session_pids = iter([1234, 2345])
    stop_worker_pids = iter([3456])
    live_pids: set[int] = set()

    def spawn_session_worker(*_args, **_kwargs):
        if not _kwargs.get("selected", True):
            return None, None, None
        pid = next(spawned_session_pids)
        live_pids.add(pid)
        return pid, f"/tmp/{pid}.log", ["python", "-m", "robotick.launcher.cli"]

    def spawn_stop_worker(*_args, **_kwargs):
        pid = next(stop_worker_pids)
        return FakeWorkerProcess(pid), f"/tmp/{pid}-stop.log", [
            "python",
            "-m",
            "robotick.launcher.workers.hub_launcher_worker",
        ]

    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_session_worker",
        spawn_session_worker,
    )
    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_stop_session_worker",
        spawn_stop_worker,
    )
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._watch_session", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._pid_alive", lambda pid: int(pid) in live_pids)

    with build_client(workspace) as client:
        barr_launch = client.post(
            "/v1/launcher/models/launch",
            json={"project_name": "barr-e", "profile": "native:ALL", "wait": True},
        )
        pip_launch = client.post(
            "/v1/launcher/models/launch",
            json={"project_name": "pip-e", "profile": "native:ALL", "wait": True},
        )
        stop_response = client.post(
            "/v1/launcher/models/stop",
            json={"project_name": "barr-e", "wait": True},
        )

    assert barr_launch.status_code == 200
    assert pip_launch.status_code == 200
    assert stop_response.status_code == 200
    assert stop_response.json()["stopped_models"] == ["brain"]
    store = ability._json_store(str(workspace))
    barr_sessions = store.list_sessions(project_id="barr-e")
    pip_sessions = store.list_sessions(project_id="pip-e")
    assert [session.lifecycle for session in barr_sessions] == ["stopped"]
    assert [session.lifecycle for session in pip_sessions] == ["starting"]


def test_launcher_all_launch_skips_models_with_live_runtime_authority(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    project_dir = workspace / "robots" / "barr-e"
    project_dir.mkdir(parents=True)
    (project_dir / "engine").mkdir()
    (project_dir / "barr-e.project.yaml").write_text(
        project_yaml("Barr.e", ["brain", "face"], ["runtime:", "  engine: ./engine"]),
        encoding="utf-8",
    )
    for model_name in ("brain", "face"):
        (project_dir / f"{model_name}.model.yaml").write_text(
            "\n".join(
                [
                    "runtime:",
                    "  target_platform: linux",
                ]
            ),
            encoding="utf-8",
        )

    spawned_models: list[str] = []

    def spawn_session_worker(_workspace_root, _project_name, _project_dir, session, **_kwargs):
        if not _kwargs.get("selected", True):
            return None, None, None
        spawned_models.append(session.model_id)
        pid = 4200 + len(spawned_models)
        return pid, f"/tmp/{pid}.log", ["python", "-m", "robotick.launcher.cli"]

    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._launcher_runtime_projection",
        lambda *_args, **_kwargs: {
            "resource_type": "robotick_launcher_runtime_status",
            "state": "running",
            "models": [
                {
                    "project_id": "barr-e",
                    "model_id": "brain",
                    "lifecycle": "running",
                    "readiness": "ready",
                    "freshness": "live",
                }
            ],
        },
    )
    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_session_worker",
        spawn_session_worker,
    )
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._watch_session", lambda *_args, **_kwargs: None)

    with build_client(workspace) as client:
        response = client.post(
            "/v1/launcher/models/launch",
            json={"project_name": "barr-e", "profile": "native:ALL", "wait": True},
        )

    assert response.status_code == 200
    assert spawned_models == ["face"]
    assert response.json()["launched_models"] == ["face"]
    assert response.json()["skipped_models"] == [
        {
            "model_id": "brain",
            "reason": "already_running",
            "message": "Model already has live runtime authority.",
        }
    ]
    sessions = {session["model_id"]: session for session in response.json()["sessions"]}
    assert sessions["face"]["lifecycle"] == "starting"


def test_launcher_model_endpoints_fan_out_and_coalesce_active_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    project_dir = workspace / "robots" / "barr-e"
    project_dir.mkdir(parents=True)
    (project_dir / "engine").mkdir()
    (project_dir / "barr-e.project.yaml").write_text(
        project_yaml("Barr.e", ["brain", "face", "spine"], ["runtime:", "  engine: ./engine"]),
        encoding="utf-8",
    )
    for model_name in ("brain", "face", "spine"):
        (project_dir / f"{model_name}.model.yaml").write_text(
            "\n".join(
                [
                    "runtime:",
                    "  target_platform: linux",
                ]
            ),
            encoding="utf-8",
        )

    spawned_models: list[str] = []
    live_pids: set[int] = set()

    def spawn_session_worker(_workspace_root, _project_name, _project_dir, session, **_kwargs):
        assert _kwargs.get("selected", True) is True
        if not spawned_models:
            runtime = ability._launcher_runtime_projection(_workspace_root, project_id="barr-e")
            states = {
                model["model_id"]: model["lifecycle"]
                for model in runtime["models"]
            }
            assert states == {
                "brain": "starting",
                "face": "starting",
                "spine": "starting",
            }
        spawned_models.append(session.model_id)
        pid = 5200 + len(spawned_models)
        live_pids.add(pid)
        return pid, f"/tmp/{pid}.log", ["python", "-m", "robotick.launcher.cli"]

    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_session_worker",
        spawn_session_worker,
    )
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._watch_session", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._pid_alive", lambda pid: int(pid) in live_pids)

    with build_client(workspace) as client:
        all_response = client.post(
            "/v1/launcher/models/launch",
            json={"project_name": "barr-e", "profile": "native:ALL", "wait": True},
        )
        duplicate_subset_response = client.post(
            "/v1/launcher/models/launch",
            json={
                "project_name": "barr-e",
                "intent": {
                    "project": "barr-e",
                    "scope": {"kind": "models", "value": ["brain", "face"]},
                    "target_policy": "native",
                },
                "wait": True,
            },
        )

    assert all_response.status_code == 200
    assert sorted(all_response.json()["launched_models"]) == ["brain", "face", "spine"]
    assert duplicate_subset_response.status_code == 200
    assert duplicate_subset_response.json()["launched_models"] == []
    assert {
        item["model_id"]: item["reason"]
        for item in duplicate_subset_response.json()["skipped_models"]
    } == {"brain": "already_running", "face": "already_running"}
    assert spawned_models == ["brain", "face", "spine"]


def test_launcher_model_launch_default_returns_pending_before_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    project_dir = workspace / "robots" / "barr-e"
    project_dir.mkdir(parents=True)
    (project_dir / "engine").mkdir()
    (project_dir / "barr-e.project.yaml").write_text(
        project_yaml("Barr.e", ["face"], ["runtime:", "  engine: ./engine"]),
        encoding="utf-8",
    )
    (project_dir / "face.model.yaml").write_text(
        "\n".join(
            [
                "runtime:",
                "  target_platform: linux",
            ]
        ),
        encoding="utf-8",
    )

    resolve_started = threading.Event()
    resolve_continue = threading.Event()
    spawn_called = threading.Event()
    spawned_models: list[str] = []
    original_resolve_launch_request = ability._resolve_launch_request

    def slow_resolve_launch_request(*args, **kwargs):
        resolve_started.set()
        resolve_continue.wait(timeout=5)
        return original_resolve_launch_request(*args, **kwargs)

    def spawn_session_worker(_workspace_root, _project_name, _project_dir, session, **_kwargs):
        spawned_models.append(session.model_id)
        spawn_called.set()
        return 7200 + len(spawned_models), "/tmp/launch.log", ["python", "-m", "robotick.launcher.cli"]

    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._resolve_launch_request",
        slow_resolve_launch_request,
    )
    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_session_worker",
        spawn_session_worker,
    )
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._watch_session", lambda *_args, **_kwargs: None)

    try:
        with build_client(workspace) as client:
            response = client.post(
                "/v1/launcher/models/launch",
                json={"project_name": "barr-e", "profile": "native:ALL"},
            )
            assert resolve_started.wait(timeout=1)
            assert spawned_models == []
            runtime_response = client.get(
                "/v1/launcher/runtime",
                params={"project_id": "barr-e"},
            )
            payload = response.json()
    finally:
        resolve_continue.set()
        spawn_called.wait(timeout=1)

    assert response.status_code == 200
    assert payload["launched_models"] == []
    assert payload["pending_models"] == ["face"]
    assert payload["runtime"]["state"] == "pending"
    assert payload["runtime"]["models"][0]["lifecycle"] == "starting"
    assert runtime_response.status_code == 200
    runtime_payload = runtime_response.json()
    runtime_models = models_by_id(runtime_payload)
    assert runtime_payload["state"] == "pending"
    assert runtime_models["face"]["lifecycle"] == "starting"
    assert runtime_models["face"]["operation"]["action"] == "launching"


def test_launcher_model_stop_and_restart_target_selected_models_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    project_dir = workspace / "robots" / "barr-e"
    project_dir.mkdir(parents=True)
    (project_dir / "engine").mkdir()
    (project_dir / "barr-e.project.yaml").write_text(
        project_yaml("Barr.e", ["brain", "face", "spine"], ["runtime:", "  engine: ./engine"]),
        encoding="utf-8",
    )
    for model_name in ("brain", "face", "spine"):
        (project_dir / f"{model_name}.model.yaml").write_text(
            "\n".join(
                [
                    "runtime:",
                    "  target_platform: linux",
                ]
            ),
            encoding="utf-8",
        )

    spawned_models: list[str] = []
    stopped_sessions: list[str] = []
    live_pids: set[int] = set()
    session_pid_by_model: dict[str, int] = {}
    model_by_session_id: dict[str, str] = {}

    def spawn_session_worker(_workspace_root, _project_name, _project_dir, session, **_kwargs):
        spawned_models.append(session.model_id)
        pid = 6200 + len(spawned_models)
        live_pids.add(pid)
        session_pid_by_model[session.model_id] = pid
        model_by_session_id[session.id] = session.model_id
        return pid, f"/tmp/{pid}.log", ["python", "-m", "robotick.launcher.cli"]

    def spawn_stop_session_worker(_workspace_root, session_id):
        stop_pid = 7200 + len(stopped_sessions)

        def on_wait(_pid):
            stopped_sessions.append(session_id)
            model_id = model_by_session_id[session_id]
            live_pids.discard(session_pid_by_model[model_id])

        return FakeWorkerProcess(stop_pid, on_wait=on_wait), f"/tmp/{stop_pid}-stop.log", ["python", "-m", "stop"]

    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_session_worker",
        spawn_session_worker,
    )
    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_stop_session_worker",
        spawn_stop_session_worker,
    )
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._watch_session", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._pid_alive", lambda pid: int(pid) in live_pids)

    with build_client(workspace) as client:
        launch_response = client.post(
            "/v1/launcher/models/launch",
            json={"project_name": "barr-e", "profile": "native:ALL", "wait": True},
        )
        face_stop_response = client.post(
            "/v1/launcher/models/stop",
            json={"project_name": "barr-e", "model_ids": ["face"], "wait": True},
        )
        brain_restart_response = client.post(
            "/v1/launcher/models/restart",
            json={
                "project_name": "barr-e",
                "intent": {
                    "project": "barr-e",
                    "scope": {"kind": "model", "value": "brain"},
                    "target_policy": "native",
                },
                "wait": True,
            },
        )

    assert launch_response.status_code == 200
    assert face_stop_response.status_code == 200
    assert brain_restart_response.status_code == 200
    assert face_stop_response.json()["stopped_models"] == ["face"]
    assert brain_restart_response.json()["stopped_models"] == ["brain"]
    assert brain_restart_response.json()["launched_models"] == ["brain"]
    assert spawned_models == ["brain", "face", "spine", "brain"]
    assert [model_by_session_id[session_id] for session_id in stopped_sessions] == ["face", "brain"]


def test_launcher_model_stop_default_returns_pending_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    project_dir = workspace / "robots" / "barr-e"
    project_dir.mkdir(parents=True)
    (project_dir / "engine").mkdir()
    (project_dir / "barr-e.project.yaml").write_text(
        project_yaml("Barr.e", ["face"], ["runtime:", "  engine: ./engine"]),
        encoding="utf-8",
    )
    (project_dir / "face.model.yaml").write_text(
        "\n".join(
            [
                "runtime:",
                "  target_platform: linux",
            ]
        ),
        encoding="utf-8",
    )

    spawned_models: list[str] = []
    live_pids: set[int] = set()
    model_by_session_id: dict[str, str] = {}
    session_pid_by_model: dict[str, int] = {}
    stop_continue = threading.Event()

    def spawn_session_worker(_workspace_root, _project_name, _project_dir, session, **_kwargs):
        spawned_models.append(session.model_id)
        pid = 8200 + len(spawned_models)
        live_pids.add(pid)
        session_pid_by_model[session.model_id] = pid
        model_by_session_id[session.id] = session.model_id
        return pid, f"/tmp/{pid}.log", ["python", "-m", "robotick.launcher.cli"]

    def spawn_stop_session_worker(_workspace_root, session_id):
        stop_pid = 9200

        def on_wait(_pid):
            stop_continue.wait(timeout=5)
            model_id = model_by_session_id[session_id]
            live_pids.discard(session_pid_by_model[model_id])

        return FakeWorkerProcess(stop_pid, on_wait=on_wait), f"/tmp/{stop_pid}-stop.log", ["python", "-m", "stop"]

    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_session_worker",
        spawn_session_worker,
    )
    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_stop_session_worker",
        spawn_stop_session_worker,
    )
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._watch_session", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._pid_alive", lambda pid: int(pid) in live_pids or int(pid) == 9200)

    try:
        with build_client(workspace) as client:
            launch_response = client.post(
                "/v1/launcher/models/launch",
                json={"project_name": "barr-e", "profile": "native:ALL", "wait": True},
            )
            stop_response = client.post(
                "/v1/launcher/models/stop",
                json={"project_name": "barr-e", "model_ids": ["face"]},
            )
            runtime_response = client.get(
                "/v1/launcher/runtime",
                params={"project_id": "barr-e"},
            )
    finally:
        stop_continue.set()

    assert launch_response.status_code == 200
    assert stop_response.status_code == 200
    payload = stop_response.json()
    assert payload["stopped_models"] == []
    assert payload["pending_models"] == ["face"]
    assert payload["runtime"]["state"] == "pending"
    assert payload["runtime"]["models"][0]["lifecycle"] == "stopping"
    assert runtime_response.status_code == 200
    runtime_payload = runtime_response.json()
    runtime_models = models_by_id(runtime_payload)
    assert runtime_payload["state"] == "pending"
    assert runtime_models["face"]["lifecycle"] == "stopping"
    assert runtime_models["face"]["operation"]["action"] == "stopping"


def test_launcher_model_restart_async_returns_restarting_before_stop_completes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    project_dir = workspace / "robots" / "barr-e"
    project_dir.mkdir(parents=True)
    (project_dir / "engine").mkdir()
    (project_dir / "barr-e.project.yaml").write_text(
        project_yaml("Barr.e", ["face"], ["runtime:", "  engine: ./engine"]),
        encoding="utf-8",
    )
    (project_dir / "face.model.yaml").write_text(
        "\n".join(
            [
                "runtime:",
                "  target_platform: linux",
            ]
        ),
        encoding="utf-8",
    )

    launched_models: list[str] = []
    live_pids: set[int] = set()
    model_by_session_id: dict[str, str] = {}
    session_pid_by_model: dict[str, int] = {}
    stop_continue = threading.Event()
    stop_wait_started = threading.Event()
    restart_launch_called = threading.Event()

    def spawn_session_worker(_workspace_root, _project_name, _project_dir, session, **_kwargs):
        launched_models.append(session.model_id)
        pid = 8300 + len(launched_models)
        live_pids.add(pid)
        session_pid_by_model[session.model_id] = pid
        model_by_session_id[session.id] = session.model_id
        if len(launched_models) > 1:
            restart_launch_called.set()
        return pid, f"/tmp/{pid}.log", ["python", "-m", "robotick.launcher.cli"]

    def spawn_stop_session_worker(_workspace_root, session_id):
        stop_pid = 9300

        def on_wait(_pid):
            stop_wait_started.set()
            stop_continue.wait(timeout=5)
            model_id = model_by_session_id[session_id]
            live_pids.discard(session_pid_by_model[model_id])

        return FakeWorkerProcess(stop_pid, on_wait=on_wait), f"/tmp/{stop_pid}-restart.log", ["python", "-m", "stop"]

    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_session_worker",
        spawn_session_worker,
    )
    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_stop_session_worker",
        spawn_stop_session_worker,
    )
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._watch_session", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._pid_alive", lambda pid: int(pid) in live_pids or int(pid) == 9300)

    with build_client(workspace) as client:
        try:
            launch_response = client.post(
                "/v1/launcher/models/launch",
                json={"project_name": "barr-e", "profile": "native:ALL", "wait": True},
            )
            restart_response = client.post(
                "/v1/launcher/models/restart",
                json={"project_name": "barr-e", "model_ids": ["face"], "wait": False},
            )
            runtime_response = client.get(
                "/v1/launcher/runtime",
                params={"project_id": "barr-e"},
            )
            stop_wait_started_before_release = stop_wait_started.wait(timeout=1)
            launched_models_before_release = list(launched_models)
        finally:
            stop_continue.set()

    assert launch_response.status_code == 200
    assert restart_response.status_code == 200
    assert stop_wait_started_before_release
    assert launched_models_before_release == ["face"]
    payload = restart_response.json()
    assert payload["stopped_models"] == []
    assert payload["launched_models"] == []
    assert payload["pending_models"] == ["face"]
    assert payload["runtime"]["state"] == "pending"
    assert payload["runtime"]["models"][0]["lifecycle"] == "stopping"
    assert payload["runtime"]["models"][0]["operation"]["action"] == "restarting"
    assert runtime_response.status_code == 200
    runtime_payload = runtime_response.json()
    runtime_models = models_by_id(runtime_payload)
    assert runtime_payload["state"] == "pending"
    assert runtime_models["face"]["lifecycle"] == "stopping"
    assert runtime_models["face"]["operation"]["action"] == "restarting"
    assert restart_launch_called.wait(timeout=1)
    assert launched_models == ["face", "face"]


def test_launcher_model_restart_keeps_queued_restarting_after_stop_finalizes() -> None:
    from robotick.launcher import domain
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    project_dir = workspace / "robots" / "barr-e"
    project_dir.mkdir(parents=True)
    (project_dir / "engine").mkdir()
    (project_dir / "barr-e.project.yaml").write_text(
        project_yaml("Barr.e", ["face"], ["runtime:", "  engine: ./engine"]),
        encoding="utf-8",
    )
    (project_dir / "face.model.yaml").write_text(
        "\n".join(
            [
                "runtime:",
                "  target_platform: linux",
            ]
        ),
        encoding="utf-8",
    )

    store = domain.LauncherSessionStore(workspace)
    intent = domain.LaunchIntent(
        project="barr-e",
        scope=domain.LaunchScope(kind=domain.ScopeKind.MODEL, value="face"),
        target_policy=domain.TargetPolicy.LOCAL,
    )
    group = store.create_group(
        domain.ModelSessionGroupRecord(
            workspace_id="robotick-knitware",
            project_id="barr-e",
            project_path=str(project_dir / "barr-e.project.yaml"),
            intent=intent,
            resolved_model_ids=["face"],
            status=domain.GroupStatus.RUNNING,
        )
    )
    session = store.create_session(
        domain.ModelSessionRecord(
            group_id=group.id,
            project_id="barr-e",
            model_id="face",
            target=domain.TargetOverride(platform="linux"),
            lifecycle=domain.SessionLifecycle.STOPPING,
            runtime={
                "worker": {
                    "pid": 8401,
                    "command": ["python", "-m", "robotick.launcher.cli"],
                    "log_path": "/tmp/8401.log",
                },
                "control": {
                    "action": "restart",
                    "pid": 9400,
                    "command": ["python", "-m", "stop"],
                    "log_path": "/tmp/9400-restart.log",
                },
            },
        )
    )
    ability._set_runtime_operation(
        str(workspace),
        session,
        project_path=str(project_dir / "barr-e.project.yaml"),
        action="restarting",
        pid=9400,
        command=["python", "-m", "stop"],
        log_path="/tmp/9400-restart.log",
        request_id="restart-request",
    )

    ability._finalize_stop_model_sessions(
        str(workspace),
        [
            (
                session,
                FakeWorkerProcess(9400, returncode=0),
                "/tmp/9400-restart.log",
                ["python", "-m", "stop"],
            )
        ],
        action="restart",
    )

    runtime_payload = ability._launcher_runtime_projection(str(workspace), project_id="barr-e")
    runtime_models = models_by_id(runtime_payload)
    operation = runtime_models["face"]["operation"]
    assert runtime_payload["state"] == "pending"
    assert runtime_models["face"]["lifecycle"] == "stopping"
    assert operation["action"] == "restarting"
    assert operation["queued"] is True
    assert operation["request_id"] == "restart-request"


def test_launcher_model_logs_snapshot_and_clear_use_per_model_offsets() -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    log_dir = workspace / ".robotick" / "logs" / "launcher-sessions"
    log_dir.mkdir(parents=True)
    log_path = log_dir / "brain.log"
    log_path.write_text("old one\nold two\n", encoding="utf-8")
    ability._write_runtime_phonebook_record(
        str(workspace),
        {
            "project_id": "barr-e",
            "model_id": "brain",
            "log_path": str(log_path),
            "last_session_id": "ms_brain",
        },
    )

    with build_client(workspace) as client:
        first = client.get(
            "/v1/launcher/models/brain/logs",
            params={"project_id": "barr-e", "tail": 10},
        )
        clear = client.post(
            "/v1/launcher/models/brain/logs/clear",
            json={"project_id": "barr-e"},
        )
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write("new one\n")
        second = client.get(
            "/v1/launcher/models/brain/logs",
            params={"project_id": "barr-e", "tail": 10},
        )

    assert first.status_code == 200
    assert [event["line"] for event in first.json()["events"]] == ["old one", "old two"]
    assert all(isinstance(event.get("timestamp"), str) for event in first.json()["events"])
    assert first.json()["sources"][0]["source_kind"] == "launcher-worker"
    assert clear.status_code == 200
    assert clear.json()["cleared_models"][0]["model_id"] == "brain"
    assert second.status_code == 200
    assert [event["line"] for event in second.json()["events"]] == ["new one"]


def test_launcher_model_logs_batch_keeps_models_and_sources_separate() -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    log_dir = workspace / ".robotick" / "logs" / "launcher-sessions"
    log_dir.mkdir(parents=True)
    brain_log = log_dir / "brain.log"
    face_log = log_dir / "face.log"
    brain_log.write_text("brain line\n", encoding="utf-8")
    face_log.write_text("face line\n", encoding="utf-8")
    for model_id, path in {"brain": brain_log, "face": face_log}.items():
        ability._write_runtime_phonebook_record(
            str(workspace),
            {
                "project_id": "barr-e",
                "model_id": model_id,
                "log_path": str(path),
                "last_session_id": f"ms_{model_id}",
            },
        )

    with build_client(workspace) as client:
        response = client.get(
            "/v1/launcher/models/logs",
            params={"project_id": "barr-e", "model_ids": "brain,face", "tail": 10},
        )

    assert response.status_code == 200
    models = {model["model_id"]: model for model in response.json()["models"]}
    assert [event["line"] for event in models["brain"]["events"]] == ["brain line"]
    assert [event["line"] for event in models["face"]["events"]] == ["face line"]


def test_launcher_model_logs_reject_unsafe_paths() -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    unsafe_log = Path(tempfile.mkdtemp()) / "outside.log"
    unsafe_log.write_text("should not leak\n", encoding="utf-8")
    ability._write_runtime_phonebook_record(
        str(workspace),
        {
            "project_id": "barr-e",
            "model_id": "brain",
            "log_path": str(unsafe_log),
            "last_session_id": "ms_brain",
        },
    )

    with build_client(workspace) as client:
        response = client.get(
            "/v1/launcher/models/brain/logs",
            params={"project_id": "barr-e", "tail": 10},
        )

    assert response.status_code == 200
    assert response.json()["sources"] == []
    assert response.json()["events"] == []


def test_launcher_model_logs_stream_emits_labelled_per_model_events() -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    log_dir = workspace / ".robotick" / "logs" / "launcher-sessions"
    log_dir.mkdir(parents=True)
    log_path = log_dir / "brain.log"
    log_path.write_text("stream line\n", encoding="utf-8")
    ability._write_runtime_phonebook_record(
        str(workspace),
        {
            "project_id": "barr-e",
            "model_id": "brain",
            "log_path": str(log_path),
            "last_session_id": "ms_brain",
        },
    )

    with build_client(workspace) as client:
        with client.websocket_connect(
            "/v1/launcher/models/logs/stream?project_id=barr-e&model_ids=brain"
        ) as websocket:
            event = websocket.receive_json()

    assert event["resource_type"] == "robotick_launcher_model_log_event"
    assert event["project_id"] == "barr-e"
    assert event["model_id"] == "brain"
    assert event["source_kind"] == "launcher-worker"
    assert event["line"] == "stream line"
    assert isinstance(event["timestamp"], str)


def test_launcher_model_log_tail_is_bounded(tmp_path: Path) -> None:
    from robotick.launcher.hub_ability import ability

    log_path = tmp_path / "model.log"
    log_path.write_text("\n".join(f"line-{index}" for index in range(20)), encoding="utf-8")

    lines, end_offset = ability._read_log_lines(log_path, tail=3)

    assert [line for _offset, line in lines] == ["line-17", "line-18", "line-19"]
    assert end_offset == log_path.stat().st_size


def test_launcher_worker_stop_uses_pid_signaling_on_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    from robotick.launcher.hub_ability import ability

    signals: list[tuple[int, signal.Signals]] = []

    monkeypatch.setattr(ability.os, "name", "nt")
    monkeypatch.setattr(ability, "_pid_alive", lambda _pid: False)
    monkeypatch.setattr(
        ability.os,
        "kill",
        lambda pid, sig: signals.append((pid, sig)),
    )

    ability._signal_worker_process_group(1234)

    assert signals == [(1234, signal.SIGTERM)]


def test_launcher_model_logs_stream_discovers_models_after_connection() -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    log_dir = workspace / ".robotick" / "logs" / "launcher-sessions"
    log_dir.mkdir(parents=True)
    log_path = log_dir / "brain.log"

    with build_client(workspace) as client:
        with client.websocket_connect(
            "/v1/launcher/models/logs/stream?project_id=barr-e"
        ) as websocket:
            log_path.write_text("late stream line\n", encoding="utf-8")
            ability._write_runtime_phonebook_record(
                str(workspace),
                {
                    "project_id": "barr-e",
                    "model_id": "brain",
                    "log_path": str(log_path),
                    "last_session_id": "ms_brain",
                },
            )
            event = websocket.receive_json()

    assert event["model_id"] == "brain"
    assert event["line"] == "late stream line"


def test_launcher_runtime_authority_handoff_marks_session_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    project_dir = workspace / "robots" / "barr-e"
    project_dir.mkdir(parents=True)
    (project_dir / "engine").mkdir()
    (project_dir / "barr-e.project.yaml").write_text(
        project_yaml("Barr.e", ["brain"], ["runtime:", "  engine: ./engine"]),
        encoding="utf-8",
    )
    (project_dir / "brain.model.yaml").write_text(
        "\n".join(
            [
                "runtime:",
                "  target_platform: linux",
                "telemetry:",
                "  port: 7090",
            ]
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_session_worker",
        lambda *_args, **_kwargs: (1234, "/tmp/1234.log", ["python", "-m", "robotick.launcher.cli"]),
    )
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._watch_session", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._pid_alive", lambda _pid: False)
    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._probe_runtime_authority",
        lambda _session, timeout=0.25: {
            "configured": True,
            "healthy": True,
            "health_url": "http://localhost:7090/api/telemetry/health",
            "error": None,
            "authority": "robotick-engine",
        },
    )

    with build_client(workspace) as client:
        launch_response = client.post(
            "/v1/launcher/models/launch",
            json={"project_name": "barr-e", "profile": "native:ALL", "wait": True},
        )

    assert launch_response.status_code == 200
    payload = launch_response.json()
    ability._refresh_state(str(workspace))
    store = ability._json_store(str(workspace))
    session = store.get_session(payload["sessions"][0]["id"])
    group = store.get_group(payload["groups"][0]["id"])
    assert session is not None
    assert group is not None
    enriched_session = ability._enrich_session_payload(
        session.model_dump(mode="json"),
        group_payload=group.model_dump(mode="json"),
    )
    assert session.lifecycle == "handed_off"
    assert session.readiness == "ready"
    assert session.runtime["authority"] == "robotick-engine"
    assert session.runtime["observation"]["source_of_truth"] == "runtime-authority"
    assert session.last_confirmed_at is not None
    assert any(
        diagnostic.code == "worker_exited_after_runtime_handoff"
        for diagnostic in session.diagnostics
    )
    assert {"kind": "runtime-health", "path": "http://localhost:7090/api/telemetry/health"} in enriched_session["log_refs"]
    assert group.status == "running"
    assert group.readiness == "ready"
    assert group.last_confirmed_at is not None


def test_launcher_runtime_probe_failure_marks_session_stale_after_handoff(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    launcher_state = workspace / ".robotick" / "launcher"
    group_dir = launcher_state / "model-session-groups"
    session_dir = launcher_state / "model-sessions"
    group_dir.mkdir(parents=True, exist_ok=True)
    session_dir.mkdir(parents=True, exist_ok=True)
    (group_dir / "msg_demo.json").write_text(
        """
{
  "resource_type": "model_session_group",
  "id": "msg_demo",
  "workspace_id": "robotick-knitware",
  "project_id": "barr-e",
  "project_path": "/tmp/barr-e.project.yaml",
  "intent": {
    "project": "barr-e",
    "scope": {"kind": "ALL", "value": "ALL"},
    "target_policy": "native",
    "target_overrides": {},
    "stage_policy": {"kind": "default", "stages": []},
    "dependency_policy": "exact",
    "desired_runtime": {"telemetry": true, "control": true},
    "created_by": {"client": "robotick-cli", "instance_id": "cli-1"}
  },
  "resolved_model_ids": ["brain"],
  "status": "running",
  "readiness": "ready",
  "created_by": {"client": "robotick-cli", "instance_id": "cli-1"},
  "diagnostics": [],
  "session_ids": ["ms_demo"],
  "created_at": "2026-06-11T12:00:00Z",
  "updated_at": "2026-06-11T12:00:00Z",
  "last_confirmed_at": "2026-06-11T12:00:00Z"
}
""".strip()
        + "\n",
        encoding="utf-8",
    )
    (session_dir / "ms_demo.json").write_text(
        """
{
  "resource_type": "model_session",
  "id": "ms_demo",
  "group_id": "msg_demo",
  "project_id": "barr-e",
  "model_id": "brain",
  "generation": 1,
  "target": {"platform": "linux", "variant": null, "host": null, "stages": []},
  "lifecycle": "handed_off",
  "readiness": "ready",
  "created_by": {"client": "robotick-cli", "instance_id": "cli-1"},
  "diagnostics": [],
  "runtime": {
    "authority": "robotick-engine",
    "probe": {
      "authority": "robotick-engine",
      "configured": true,
      "health_urls": ["http://localhost:7090/api/telemetry/health", "http://localhost:7090/health"]
    }
  },
  "created_at": "2026-06-11T12:00:00Z",
  "updated_at": "2026-06-11T12:00:00Z",
  "last_confirmed_at": "2026-06-11T12:00:00Z"
}
""".strip()
        + "\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._probe_runtime_authority",
        lambda _session, timeout=0.25: {
            "configured": True,
            "healthy": False,
            "health_url": "http://localhost:7090/api/telemetry/health",
            "error": "connection refused",
            "authority": "robotick-engine",
        },
    )
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._pid_alive", lambda _pid: False)

    ability._refresh_state(str(workspace))
    store = ability._json_store(str(workspace))
    session = store.get_session("ms_demo")
    group = store.get_group("msg_demo")
    assert session is not None
    assert group is not None
    assert session.lifecycle == "stale"
    assert session.readiness == "stale"
    assert session.runtime["observation"]["source_of_truth"] == "last-known-runtime"
    assert any(
        diagnostic.code == "runtime_probe_stale"
        for diagnostic in session.diagnostics
    )
    assert group.status == "stale"
    assert group.readiness == "stale"


def test_launcher_runtime_probe_failure_before_handoff_records_worker_exit_diagnostic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robotick.launcher.hub_ability import ability

    workspace = create_fake_workspace()
    project_dir = workspace / "robots" / "barr-e"
    project_dir.mkdir(parents=True)
    (project_dir / "engine").mkdir()
    (project_dir / "barr-e.project.yaml").write_text(
        project_yaml("Barr.e", ["brain"], ["runtime:", "  engine: ./engine"]),
        encoding="utf-8",
    )
    (project_dir / "brain.model.yaml").write_text(
        "\n".join(
            [
                "runtime:",
                "  target_platform: linux",
                "telemetry:",
                "  port: 7090",
            ]
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._spawn_session_worker",
        lambda *_args, **_kwargs: (1234, "/tmp/1234.log", ["python", "-m", "robotick.launcher.cli"]),
    )
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._watch_session", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("robotick.launcher.hub_ability.ability._pid_alive", lambda _pid: False)
    monkeypatch.setattr(
        "robotick.launcher.hub_ability.ability._probe_runtime_authority",
        lambda _session, timeout=0.25: {
            "configured": True,
            "healthy": False,
            "health_url": "http://localhost:7090/api/telemetry/health",
            "error": "connection refused",
            "authority": "robotick-engine",
        },
    )

    with build_client(workspace) as client:
        launch_response = client.post(
            "/v1/launcher/models/launch",
            json={"project_name": "barr-e", "profile": "native:ALL", "wait": True},
        )
    assert launch_response.status_code == 200
    session_id = launch_response.json()["sessions"][0]["id"]

    ability._refresh_state(str(workspace))
    session = ability._json_store(str(workspace)).get_session(session_id)
    assert session is not None
    assert session.lifecycle == "stopped"
    assert session.readiness == "pending"
    assert any(
        diagnostic.code == "worker_exited_without_runtime_handoff"
        for diagnostic in session.diagnostics
    )


def test_studio_instances_open_and_quit_endpoints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    instances_summary = {
        "name": "studio-1234",
        "pid": 1234,
        "mode": "dev",
        "started_at": "2026-06-06T12:00:00+00:00",
        "state": "running",
        "project_name": None,
        "log_path": "/tmp/studio.log",
        "control_endpoint": None,
    }
    open_summary = {
        "name": "studio-1234",
        "pid": 1234,
        "mode": "dev",
        "started_at": "2026-06-06T12:00:00+00:00",
        "state": "running",
        "project_name": "barr-e",
        "log_path": "/tmp/studio.log",
        "control_endpoint": None,
    }
    monkeypatch.setattr("robotick.studio_ability.hub_ability.ability.list_instances", lambda _: [instances_summary])
    monkeypatch.setattr(
        "robotick.studio_ability.hub_ability.ability.open_studio",
        lambda _, project_name=None: (open_summary, {"launcher_service": {"action": "started"}}),
    )
    monkeypatch.setattr(
        "robotick.studio_ability.hub_ability.ability.quit_instance",
        lambda _, instance_id: (True, f"Studio instance {instance_id} closed.", open_summary),
    )
    with build_client(workspace) as client:
        instances_response = client.get("/v1/studio/instances")
        open_response = client.post("/v1/studio/open", json={"project_name": "barr-e"})
        quit_response = client.post("/v1/studio/instances/studio-1234/quit")
        assert instances_response.status_code == 200
        assert instances_response.json()["resource_type"] == "robotick_studio_instances"
        assert instances_response.json()["instances"][0]["name"] == "studio-1234"
        assert instances_response.json()["instances"][0]["project_name"] is None
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
        "robotick.studio_ability.hub_ability.ability.get_studio_status",
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
    monkeypatch.setattr("robotick.studio_ability.domain.is_instance_alive", lambda _instance: True)
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

    monkeypatch.setattr("robotick.studio_ability.domain.urlopen", lambda url, timeout: FakeResponse())

    with build_client(workspace) as client:
        response = client.get("/v1/studio/instances/studio-1234/status")

    assert response.status_code == 200
    assert response.json()["state"] == "runtime"


def test_studio_status_endpoint_surfaces_provider_unavailable_without_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr("robotick.studio_ability.domain.is_instance_alive", lambda _instance: True)
    write_instance_record(
        workspace,
        StudioInstanceRecord(
            name="studio-1234",
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint=None,
        ),
    )

    with build_client(workspace) as client:
        response = client.get("/v1/studio/instances/studio-1234/status")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"


def test_studio_status_endpoint_surfaces_provider_unavailable_for_unreachable_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr("robotick.studio_ability.domain.is_instance_alive", lambda _instance: True)
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
    monkeypatch.setattr(
        "robotick.studio_ability.domain.urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(URLError("connection refused")),
    )

    with build_client(workspace) as client:
        response = client.get("/v1/studio/instances/studio-1234/status")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"


def test_studio_focused_endpoint_surfaces_provider_unavailable_without_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr("robotick.studio_ability.domain.is_instance_alive", lambda _instance: True)
    write_instance_record(
        workspace,
        StudioInstanceRecord(
            name="studio-1234",
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint=None,
        ),
    )

    with build_client(workspace) as client:
        response = client.get("/v1/studio/instances/studio-1234/focused")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"


def test_studio_deep_status_endpoint_surfaces_not_found_for_missing_control_resource(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr("robotick.studio_ability.domain.is_instance_alive", lambda _instance: True)
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
    monkeypatch.setattr(
        "robotick.studio_ability.domain.urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            HTTPError(
                "http://127.0.0.1:7123/v1/studio/windows/missing-window/status",
                404,
                "Not Found",
                hdrs=None,
                fp=None,
            )
        ),
    )

    with build_client(workspace) as client:
        response = client.get("/v1/studio/instances/studio-1234/windows/missing-window/status")

    assert response.status_code == 404
    assert "Studio resource not found" in response.json()["detail"]


def test_studio_diagnostics_endpoint_proxies_to_control_endpoint(
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

    captured_kinds: list[str] = []

    def fake_diagnostics(_, instance_id, kind):
        captured_kinds.append(kind)
        if instance_id != "studio-1234":
            return None
        return {
            "resource_type": f"studio_diagnostics_{kind.split('?')[0].replace('-', '_').replace('/', '_')}",
            "instance_id": instance_id,
            "current_hub_endpoint": "http://127.0.0.1:7000",
        }

    monkeypatch.setattr(
        "robotick.studio_ability.hub_ability.ability.get_studio_diagnostics",
        fake_diagnostics,
    )

    with build_client(workspace) as client:
        response = client.get("/v1/studio/instances/studio-1234/diagnostics/endpoints")
        renderer_response = client.get("/v1/studio/instances/studio-1234/diagnostics/renderer")
        fetch_check_response = client.get("/v1/studio/instances/studio-1234/diagnostics/fetch-check")
        telemetry_response = client.get("/v1/studio/instances/studio-1234/diagnostics/telemetry")
        dom_query_response = client.get(
            "/v1/studio/instances/studio-1234/diagnostics/dom/query?selector=%5Bdata-project-picker%5D"
        )

    assert response.status_code == 200
    assert response.json()["resource_type"] == "studio_diagnostics_endpoints"
    assert response.json()["instance_id"] == "studio-1234"
    assert renderer_response.status_code == 200
    assert renderer_response.json()["resource_type"] == "studio_diagnostics_renderer"
    assert fetch_check_response.status_code == 200
    assert fetch_check_response.json()["resource_type"] == "studio_diagnostics_fetch_check"
    assert telemetry_response.status_code == 200
    assert telemetry_response.json()["resource_type"] == "studio_diagnostics_telemetry"
    assert dom_query_response.status_code == 200
    assert dom_query_response.json()["resource_type"] == "studio_diagnostics_dom_query"
    assert "dom/query?selector=%5Bdata-project-picker%5D" in captured_kinds


def test_studio_diagnostics_endpoint_surfaces_provider_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr(
        "robotick.studio_ability.hub_ability.ability.get_studio_diagnostics",
        lambda *_args: {
            "error": {
                "code": "provider_unavailable",
                "message": "Diagnostics unavailable.",
                "recovery": "Reopen Studio.",
            }
        },
    )

    with build_client(workspace) as client:
        response = client.get("/v1/studio/instances/studio-1234/diagnostics/status")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"


def test_studio_project_select_proxies_to_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr("robotick.studio_ability.domain.is_instance_alive", lambda _instance: True)
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

    monkeypatch.setattr("robotick.studio_ability.domain.urlopen", fake_urlopen)

    with build_client(workspace) as client:
        response = client.post(
            "/v1/studio/instances/studio-1234/project/select",
            json={"project_path": "/tmp/barr-e.project.yaml"},
        )

    assert response.status_code == 200
    assert response.json()["accepted"] is True
    assert captured["url"] == "http://127.0.0.1:7123/v1/project/select"
    assert '"project_path": "/tmp/barr-e.project.yaml"' in captured["body"]


def test_studio_project_select_surfaces_provider_unavailable_without_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr("robotick.studio_ability.domain.is_instance_alive", lambda _instance: True)
    write_instance_record(
        workspace,
        StudioInstanceRecord(
            name="studio-1234",
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint=None,
        ),
    )

    with build_client(workspace) as client:
        response = client.post(
            "/v1/studio/instances/studio-1234/project/select",
            json={"project_path": "/tmp/barr-e.project.yaml"},
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"


def test_studio_instances_hide_cached_selected_project_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr("robotick.studio_ability.domain.is_instance_alive", lambda _instance: True)
    write_instance_record(
        workspace,
        StudioInstanceRecord(
            name="studio-1234",
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            project_name="barr-e",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    with build_client(workspace) as client:
        response = client.get("/v1/studio/instances")

    assert response.status_code == 200
    instances = response.json()["instances"]
    assert len(instances) == 1
    assert instances[0]["name"] == "studio-1234"
    assert instances[0]["project_name"] is None


def test_studio_activation_proxies_to_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr("robotick.studio_ability.domain.is_instance_alive", lambda _instance: True)
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

    monkeypatch.setattr("robotick.studio_ability.domain.urlopen", fake_urlopen)

    with build_client(workspace) as client:
        response = client.post(
            "/v1/studio/instances/studio-1234/windows/main/activate",
        )

    assert response.status_code == 200
    assert response.json()["accepted"] is True
    assert response.json()["activated_path"] == ["windows", "main"]
    assert captured["url"] == "http://127.0.0.1:7123/v1/studio/windows/main/activate"
    assert captured["body"] == "{}"


def test_studio_activation_surfaces_provider_unavailable_without_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr("robotick.studio_ability.domain.is_instance_alive", lambda _instance: True)
    write_instance_record(
        workspace,
        StudioInstanceRecord(
            name="studio-1234",
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint=None,
        ),
    )

    with build_client(workspace) as client:
        response = client.post("/v1/studio/instances/studio-1234/windows/main/activate")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"


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
        "robotick.studio_ability.hub_ability.ability.notify_instance_closing",
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


def test_reconcile_keeps_inflight_stop_sessions_in_stopping_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robotick.launcher.hub_ability import ability

    domain = ability._launcher_domain()
    session = domain.ModelSessionRecord(
        group_id="msg_demo",
        project_id="barr-e",
        model_id="brain",
        lifecycle=domain.SessionLifecycle.STOPPING,
        readiness="pending",
        runtime={
            "control": {
                "action": "stop",
                "pid": 4242,
                "started_at": "2026-06-12T06:00:00Z",
            },
            "probe": {
                "authority": "robotick-engine",
                "configured": True,
                "health_urls": ["http://localhost:7090/api/telemetry/health"],
            },
        },
    )

    monkeypatch.setattr(
        ability,
        "_probe_runtime_authority",
        lambda _session, timeout=0.25: {
            "configured": True,
            "healthy": True,
            "health_url": "http://localhost:7090/api/telemetry/health",
            "error": None,
            "authority": "robotick-engine",
        },
    )

    reconciled = ability._reconcile_session_runtime_state(
        "/tmp/workspace",
        session,
        worker_alive=False,
    )

    assert reconciled.lifecycle == domain.SessionLifecycle.STOPPING
    assert reconciled.readiness == "pending"
    assert "returncode" not in reconciled.runtime["control"]


def test_refresh_state_reloads_latest_session_before_reconcile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robotick.launcher.hub_ability import ability

    stale_session = SimpleNamespace(
        id="ms_demo",
        runtime={},
        updated_at="2026-06-12T06:00:00Z",
    )
    fresh_session = SimpleNamespace(
        id="ms_demo",
        runtime={"control": {"action": "stop", "returncode": 0}},
        updated_at="2026-06-12T06:00:05Z",
    )
    group = SimpleNamespace(id="msg_demo")

    class FakeStore:
        def list_groups(self):
            return [group]

        def list_sessions(self, group_id=None):
            assert group_id == "msg_demo"
            return [stale_session]

        def get_session(self, session_id):
            assert session_id == "ms_demo"
            return fresh_session

        def update_session(self, session):
            raise AssertionError("update_session should not be called in this scenario")

    fake_store = FakeStore()
    seen_updated_at: list[str] = []

    monkeypatch.setattr(
        ability,
        "_launcher_domain",
        lambda: SimpleNamespace(LauncherSessionStore=lambda _workspace_root: fake_store),
    )
    monkeypatch.setattr(ability, "_pid_alive", lambda _pid: False)
    monkeypatch.setattr(ability, "_refresh_group_record", lambda *_args, **_kwargs: None)

    def fake_reconcile(_workspace_root, session, *, worker_alive):
        assert worker_alive is False
        seen_updated_at.append(session.updated_at)
        return session

    monkeypatch.setattr(ability, "_reconcile_session_runtime_state", fake_reconcile)

    ability._refresh_state("/tmp/workspace")

    assert seen_updated_at == ["2026-06-12T06:00:05Z"]
