from __future__ import annotations

import json
from pathlib import Path

import pytest

from robotick.launcher.actions.launch.project_workspace_hydration import (
    get_project_python_dir,
    LOCK_FILENAME,
)
from robotick.launcher.actions.launch.run import _build_python_env


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
