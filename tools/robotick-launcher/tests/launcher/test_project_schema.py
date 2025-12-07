from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from robotick.launcher.config import Config


def _write_project(tmp_path: Path, data: dict) -> Path:
    base = tmp_path / "my-robot"
    base.mkdir(parents=True, exist_ok=True)
    (base / "my-robot.project.yaml").write_text(yaml.safe_dump(data))
    return base


def _make_config(base_dir: Path) -> Config:
    return Config(
        project="my-robot",
        model=None,
        target=None,
        base_dir=base_dir,
        dry_run=True,
        stub_install=False,
    )


def test_config_accepts_new_tooling_and_runtime_schema(tmp_path):
    project_yaml = {
        "tooling": {
            "robotick": {"repo": "https://github.com/robotick/robotick-studio.git", "ref": "v0.9.1"},
            "bootstrap": "./robots/my-robot.setup.sh",
        },
        "runtime": {
            "engine": {"repo": "https://github.com/robotick/robotick-engine.git", "ref": "main"},
            "workload_repos": [
                {"repo": "https://github.com/robotick/workloads.git", "ref": "main"},
            ],
            "shared_repos": [
                {"repo": "https://github.com/robotick/shared-assets.git", "ref": "main"},
            ],
            "local_workload_roots": ["workloads/cpp"],
            "local_python_roots": [
                {"id": "brain", "path": "python", "requirements": "requirements.txt"}
            ],
        },
    }

    base_dir = _write_project(tmp_path, project_yaml)
    config = _make_config(base_dir)

    assert config.tooling.robotick.repo == "https://github.com/robotick/robotick-studio.git"
    assert config.tooling.bootstrap == "./robots/my-robot.setup.sh"
    assert config.runtime.engine.repo == "https://github.com/robotick/robotick-engine.git"
    assert config.runtime.local_workload_roots == ["workloads/cpp"]

    # local_python_roots are still parsed into python_roots for compatibility
    assert len(config.python_roots) == 1
    assert config.python_roots[0].id == "brain"
    assert config.project.get("local_workload_roots") == ["workloads/cpp"]


def test_tooling_schema_requires_repo_and_ref(tmp_path):
    project_yaml = {
        "tooling": {"robotick": {"ref": "main"}},
        "runtime": {},
    }
    base_dir = _write_project(tmp_path, project_yaml)
    with pytest.raises(ValueError):
        _make_config(base_dir)


def test_runtime_schema_validates_workload_repos(tmp_path):
    project_yaml = {
        "tooling": {"robotick": {"repo": "https://github.com/robotick/studio.git", "ref": "main"}},
        "runtime": {"workload_repos": {"repo": "https://github.com/robotick/w.git", "ref": "main"}},
    }
    base_dir = _write_project(tmp_path, project_yaml)
    with pytest.raises(ValueError):
        _make_config(base_dir)
