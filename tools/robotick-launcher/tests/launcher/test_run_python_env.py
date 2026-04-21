from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from robotick.launcher.actions.launch.project_workspace_hydration import (
    get_project_python_dir,
    LOCK_FILENAME,
)
from robotick.launcher.actions.launch.docker_linux import (
    DOCKER_PYTHON_ENV_FORWARD_FLAG,
)
from robotick.launcher.actions.launch.run import (
    _build_python_env,
    _run_handler_with_python_env,
)


def test_build_python_env_combines_paths(monkeypatch, tmp_path):
    workspace = tmp_path
    project = "test-project"
    python_dir = get_project_python_dir(project, workspace)
    python_dir.mkdir(parents=True)
    lock_path = python_dir / LOCK_FILENAME
    lock_path.write_text(
        json.dumps(
            {
                "venv_path": "/tmp/venv",
                "site_packages": "/tmp/venv/lib/python3.12/site-packages",
                "python_roots": [
                    {"absolute_path": "/repo/python"},
                    {"absolute_path": "/repo/tools"},
                ],
            }
        )
    )

    monkeypatch.setenv("PYTHONPATH", "/existing")

    env = _build_python_env(project, workspace)
    assert env is not None
    assert env["ROBOTICK_PYTHON_VENV"] == "/tmp/venv"
    assert env["PYTHONPATH"].startswith(
        "/tmp/venv/lib/python3.12/site-packages"
    )
    assert "/repo/python" in env["PYTHONPATH"]
    assert env["PYTHONPATH"].endswith("/existing")


def test_build_python_env_returns_none_when_no_lock(tmp_path):
    env = _build_python_env("missing-project", tmp_path)
    assert env is None


def test_run_handler_with_python_env_marks_docker_forwarding(monkeypatch):
    monkeypatch.setenv("PYTHONPATH", "/original")
    monkeypatch.delenv("ROBOTICK_PYTHON_VENV", raising=False)
    monkeypatch.delenv(DOCKER_PYTHON_ENV_FORWARD_FLAG, raising=False)

    seen: dict[str, str | None] = {}

    def handler(dry_run: bool) -> None:
        assert dry_run is True
        seen["PYTHONPATH"] = os.environ.get("PYTHONPATH")
        seen["ROBOTICK_PYTHON_VENV"] = os.environ.get("ROBOTICK_PYTHON_VENV")
        seen["flag"] = os.environ.get(DOCKER_PYTHON_ENV_FORWARD_FLAG)

    _run_handler_with_python_env(
        handler,
        True,
        {
            "PYTHONPATH": "/tmp/site-packages:/repo/robots/barr-e/python",
            "ROBOTICK_PYTHON_VENV": "/tmp/venv",
        },
    )

    assert seen == {
        "PYTHONPATH": "/tmp/site-packages:/repo/robots/barr-e/python",
        "ROBOTICK_PYTHON_VENV": "/tmp/venv",
        "flag": "1",
    }
    assert os.environ.get("PYTHONPATH") == "/original"
    assert os.environ.get("ROBOTICK_PYTHON_VENV") is None
    assert os.environ.get(DOCKER_PYTHON_ENV_FORWARD_FLAG) is None
