from __future__ import annotations

import json
import shutil
from pathlib import Path

import yaml

from robotick.launcher.actions.launch import install_deps


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

    venv_path = workspace_dir / ".studio" / ".venv-python"
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
    assert not (workspace_dir / ".studio" / ".venv-python").exists()
