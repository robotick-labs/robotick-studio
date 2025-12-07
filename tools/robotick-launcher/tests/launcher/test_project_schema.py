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
            "tooling_sources": [
                {"id": "robotick-studio", "repo": "https://github.com/robotick/robotick-studio.git", "ref": "v0.9.1"}
            ],
        },
        "runtime": {
            "engine": {"local_path": "${PROJECT_DIR}/../engine"},
            "workloads": [
                {"repo": "https://github.com/robotick/workloads.git", "ref": "main"},
                {"local_path": "workloads/cpp"},
            ],
            "shared": [
                {"repo": "https://github.com/robotick/shared-assets.git", "ref": "main"},
            ],
            "python_roots": [
                {"id": "brain", "local_path": "python", "requirements": "requirements.txt"}
            ],
        },
    }

    base_dir = _write_project(tmp_path, project_yaml)
    config = _make_config(base_dir)

    assert len(config.tooling.tooling_sources) == 1
    assert config.tooling.tooling_sources[0]["repo"] == "https://github.com/robotick/robotick-studio.git"
    assert config.tooling.tooling_sources[0]["id"] == "robotick-studio"
    assert config.tooling.bootstrap == "./my-robot.setup.sh"
    assert config.runtime.engine.local_path == "${PROJECT_DIR}/../engine"
    assert len(config.runtime.workload_sources) == 2
    assert config.runtime.workload_sources[1]["local_path"] == "workloads/cpp"

    # python_roots are parsed into Config.python_roots for downstream consumers
    assert len(config.python_roots) == 1
    assert config.python_roots[0].id == "brain"


def test_tooling_schema_requires_repo_and_ref(tmp_path):
    project_yaml = {
        "tooling": {"tooling_sources": [{"id": "robotick-studio", "ref": "main"}]},
        "runtime": {},
    }
    base_dir = _write_project(tmp_path, project_yaml)
    with pytest.raises(ValueError):
        _make_config(base_dir)


def test_runtime_schema_validates_workload_repos(tmp_path):
    project_yaml = {
        "tooling": {"tooling_sources": [{"id": "robotick-studio", "repo": "https://github.com/robotick/studio.git", "ref": "main"}]},
        "runtime": {"workloads": {"repo": "https://github.com/robotick/w.git", "ref": "main"}},
    }
    base_dir = _write_project(tmp_path, project_yaml)
    with pytest.raises(ValueError):
        _make_config(base_dir)


def test_workload_sources_support_root_paths(tmp_path):
    project_yaml = {
        "tooling": {"tooling_sources": [{"id": "robotick-studio", "repo": "https://github.com/robotick/studio.git", "ref": "main"}]},
        "runtime": {
            "workload_sources": [
                {"id": "foo", "local_path": "workloads", "root_paths": ["include", "src"]}
            ]
        },
    }
    base_dir = _write_project(tmp_path, project_yaml)
    config = _make_config(base_dir)
    entry = config.runtime.workload_sources[0]
    assert entry["root_paths"] == ["include", "src"]


def test_workload_sources_reject_invalid_root_paths(tmp_path):
    project_yaml = {
        "tooling": {"tooling_sources": [{"id": "robotick-studio", "repo": "https://github.com/robotick/studio.git", "ref": "main"}]},
        "runtime": {
            "workload_sources": [
                {"id": "foo", "local_path": "workloads", "root_paths": "include"}
            ]
        },
    }
    base_dir = _write_project(tmp_path, project_yaml)
    with pytest.raises(ValueError):
        _make_config(base_dir)
