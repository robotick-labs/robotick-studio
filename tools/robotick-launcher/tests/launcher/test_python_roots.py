from __future__ import annotations

import shutil
from pathlib import Path

import pytest
import yaml

FIXTURE_BASE = Path(__file__).resolve().parent.parent / "test_data" / "test-project"


def test_python_roots_are_exposed_on_config(make_test_config):
    config = make_test_config(
        FIXTURE_BASE,
        project="test-project",
        model="test-project-brain",
        target="linux",
    )

    assert len(config.python_roots) == 2
    first = config.python_roots[0]
    assert first.id == "main-brain"
    assert first.relative_path == Path("${PROJECT_DIR}/python")
    assert first.absolute_path == (FIXTURE_BASE / "python").resolve()
    assert first.requirements_file == Path("requirements.txt")
    assert first.requirements_absolute == (FIXTURE_BASE / "python" / "requirements.txt").resolve()

    second = config.python_roots[1]
    assert second.id == "scripts"
    assert second.relative_path == Path("${PROJECT_DIR}/tools/scripts")
    assert second.requirements_file is None
    assert second.requirements_absolute is None


def _clone_fixture(tmp_path: Path) -> Path:
    dest = tmp_path / "test-project"
    shutil.copytree(FIXTURE_BASE, dest)
    return dest


def _mutate_project_yaml(base_dir: Path, mutator):
    project_file = base_dir / "test-project.project.yaml"
    data = yaml.safe_load(project_file.read_text())
    mutator(data)
    project_file.write_text(yaml.safe_dump(data))


def test_python_roots_require_id_and_path(tmp_path, make_test_config):
    base_dir = _clone_fixture(tmp_path)

    def mutator(data):
        runtime = data.setdefault("runtime", {})
        runtime["python_roots"] = [{"local_path": "python"}]

    _mutate_project_yaml(base_dir, mutator)

    with pytest.raises(ValueError):
        make_test_config(
            base_dir,
            project="test-project",
            model="test-project-brain",
            target="linux",
        )


def test_python_roots_enforce_unique_ids(tmp_path, make_test_config):
    base_dir = _clone_fixture(tmp_path)

    def mutator(data):
        runtime = data.setdefault("runtime", {})
        runtime["python_roots"] = [
            {"id": "dup", "local_path": "python"},
            {"id": "dup", "local_path": "python2"},
        ]

    _mutate_project_yaml(base_dir, mutator)

    with pytest.raises(ValueError):
        make_test_config(
            base_dir,
            project="test-project",
            model="test-project-brain",
            target="linux",
        )
