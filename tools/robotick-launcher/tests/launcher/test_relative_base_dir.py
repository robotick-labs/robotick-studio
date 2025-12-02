import os
from pathlib import Path

import pytest

from robotick.launcher.actions.launch.generate import generate


def test_generate_respects_explicit_base_dir(tmp_path, monkeypatch):
    project_dir = tmp_path / "pip"
    project_dir.mkdir()
    engine_dir = project_dir / "engine"
    engine_dir.mkdir()
    (project_dir / "pip.project.yaml").write_text(
        """
robotick_engine_root: engine
local_workload_roots:
  - .
        """.strip()
    )
    (project_dir / "pip.model.yaml").write_text("workloads: []\n")

    other_dir = tmp_path / "other"
    other_dir.mkdir()
    wrong_project = other_dir / "pip.project.yaml"
    wrong_project.write_text("# wrong project\n")

    runner_cwd = tmp_path / "runner"
    runner_cwd.mkdir()

    original_cwd = Path.cwd()
    os.chdir(runner_cwd)

    try:
        generate(
            project="pip",
            model="pip",
            target="linux",
            base_dir=project_dir,
            dry_run=True,
            stub_install=True,
        )
    finally:
        os.chdir(original_cwd)
