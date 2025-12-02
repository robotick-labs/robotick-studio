from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
import yaml

from robotick.launcher.actions.launch import install_deps, generate as generate_module


FIXTURE_BASE = Path(__file__).resolve().parent.parent / "test_data" / "test-project"


def _clone_fixture(tmp_path: Path) -> Path:
    dest = tmp_path / "test-project"
    shutil.copytree(FIXTURE_BASE, dest)
    return dest


def test_install_deps_creates_shared_venv_and_lock(tmp_path):
    project_dir = _clone_fixture(tmp_path)
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    result = install_deps.install_deps(
        project="test-project",
        base_dir=project_dir,
        workspace_root=workspace_dir,
        dry_run=False,
        stub_install=True,
    )

    assert result is not None

    venv_path = (
        workspace_dir / ".launcher" / "test_project" / "python" / ".venv-python"
    )
    assert venv_path.exists()
    assert result.lock_path.exists()

    payload = json.loads(result.lock_path.read_text())
    assert payload["project"] == "test-project"
    assert len(payload["python_roots"]) == 2


def test_install_deps_no_python_roots_is_noop(tmp_path):
    project_dir = _clone_fixture(tmp_path)
    project_file = project_dir / "test-project.project.yaml"
    data = yaml.safe_load(project_file.read_text())
    data.pop("python_roots", None)
    project_file.write_text(yaml.safe_dump(data))

    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    result = install_deps.install_deps(
        project="test-project",
        base_dir=project_dir,
        workspace_root=workspace_dir,
        dry_run=False,
        stub_install=True,
    )
    assert result is None
    assert not (
        workspace_dir / ".launcher" / "test_project" / "python" / ".venv-python"
    ).exists()


def test_generate_auto_runs_install_deps(monkeypatch, tmp_path):
    project_dir = _clone_fixture(tmp_path)
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    captured = {}

    def fake_install_deps(**kwargs):
        captured["kwargs"] = kwargs

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.generate.install_deps_stage.install_deps",
        fake_install_deps,
    )

    generate_module.generate(
        "test-project",
        "test-project-brain",
        "linux",
        base_dir=project_dir,
        dry_run=True,
        stub_install=True,
        workspace_dir=workspace_dir,
    )

    assert "kwargs" in captured
    assert captured["kwargs"]["workspace_root"] == workspace_dir


def test_generate_skips_install_deps_when_no_python_roots(monkeypatch, tmp_path):
    project_dir = _clone_fixture(tmp_path)
    project_file = project_dir / "test-project.project.yaml"
    data = yaml.safe_load(project_file.read_text())
    data.pop("python_roots", None)
    project_file.write_text(yaml.safe_dump(data))

    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    called = False

    def fake_install_deps(**kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.generate.install_deps_stage.install_deps",
        fake_install_deps,
    )

    generate_module.generate(
        "test-project",
        "test-project-brain",
        "linux",
        base_dir=project_dir,
        dry_run=True,
        stub_install=True,
        workspace_dir=workspace_dir,
    )

    assert not called
