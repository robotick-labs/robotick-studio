from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from robotick_hub.app import create_app
from robotick_hub.runtime import get_hub_record_path


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
        assert get_hub_record_path(workspace).exists()
    assert not get_hub_record_path(workspace).exists()


def test_capabilities_endpoint() -> None:
    workspace = create_fake_workspace()
    with build_client(workspace) as client:
        response = client.get("/v1/capabilities")
        assert response.status_code == 200
        names = [item["name"] for item in response.json()["capabilities"]]
        assert names == ["workspace", "studio", "launcher"]


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
