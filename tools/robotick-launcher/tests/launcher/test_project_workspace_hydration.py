from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

from robotick.launcher.actions.launch import (
    project_workspace_hydration,
    generate as generate_module,
)
from robotick.launcher.config import Config
from robotick.launcher.utils import copy_extras_for_target


FIXTURE_BASE = Path(__file__).resolve().parent.parent / "test_data" / "test-project"


def _clone_fixture(tmp_path: Path) -> Path:
    dest = tmp_path / "test-project"
    shutil.copytree(FIXTURE_BASE, dest)
    return dest


def _init_git_repo(repo_path: Path, filename: str) -> str:
    repo_path.mkdir()
    subprocess.run(["git", "init"], cwd=repo_path, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(
        ["git", "config", "user.email", "ci@example.com"], cwd=repo_path, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    subprocess.run(
        ["git", "config", "user.name", "CI"], cwd=repo_path, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    subprocess.run(["git", "checkout", "-b", "main"], cwd=repo_path, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    target_file = repo_path / filename
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_text("content", encoding="utf-8")
    subprocess.run(["git", "add", filename], cwd=repo_path, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["git", "commit", "-m", "init"], cwd=repo_path, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return "main"


def test_project_workspace_hydration_creates_shared_venv_and_lock(tmp_path):
    project_dir = _clone_fixture(tmp_path)
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    result = project_workspace_hydration.hydrate_project_workspace(
        project="test-project",
        base_dir=project_dir,
        workspace_root=workspace_dir,
        dry_run=False,
        stub_install=True,
    )

    assert result is not None

    venv_path = (
        workspace_dir
        / ".launcher"
        / "test_project"
        / "deps"
        / "python"
        / ".venv-python"
    )
    assert venv_path.exists()
    assert result.lock_path.exists()

    payload = json.loads(result.lock_path.read_text())
    assert payload["project"] == "test-project"
    assert len(payload["python_roots"]) == 2


def test_project_workspace_hydration_no_python_roots_is_noop(tmp_path):
    project_dir = _clone_fixture(tmp_path)
    project_file = project_dir / "test-project.project.yaml"
    data = yaml.safe_load(project_file.read_text())
    runtime = data.get("runtime")
    if isinstance(runtime, dict):
        runtime.pop("python_roots", None)
    project_file.write_text(yaml.safe_dump(data))

    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    lock_path = (
        workspace_dir
        / ".launcher"
        / "test_project"
        / "deps"
        / "python"
        / "python-roots-lock.json"
    )
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text('{"stale": true}', encoding="utf-8")

    result = project_workspace_hydration.hydrate_project_workspace(
        project="test-project",
        base_dir=project_dir,
        workspace_root=workspace_dir,
        dry_run=False,
        stub_install=True,
    )
    assert result is not None
    assert result.python_roots == []
    assert not (
        workspace_dir
        / ".launcher"
        / "test_project"
        / "deps"
        / "python"
        / ".venv-python"
    ).exists()
    assert not lock_path.exists()


def test_generate_auto_runs_prepare_project_workspace(monkeypatch, tmp_path):
    project_dir = _clone_fixture(tmp_path)
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    captured = {}
    docker_captured = {}

    def fake_prepare_project_workspace(**kwargs):
        captured["kwargs"] = kwargs

    def fake_prepare_project_docker(**kwargs):
        docker_captured["kwargs"] = kwargs

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.generate.prepare_project_workspace_stage.prepare_project_workspace",
        fake_prepare_project_workspace,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.generate.prepare_project_docker",
        fake_prepare_project_docker,
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
    assert "kwargs" in docker_captured
    assert captured["kwargs"]["workspace_root"] == workspace_dir
    assert captured["kwargs"]["model"] == "test-project-brain"
    assert captured["kwargs"]["target"] == "linux"
    assert docker_captured["kwargs"]["model"] == "test-project-brain"
    assert docker_captured["kwargs"]["target"] == "linux"


def test_generate_calls_prepare_project_workspace_even_without_python(monkeypatch, tmp_path):
    project_dir = _clone_fixture(tmp_path)
    project_file = project_dir / "test-project.project.yaml"
    data = yaml.safe_load(project_file.read_text())
    runtime = data.get("runtime")
    if isinstance(runtime, dict):
        runtime.pop("python_roots", None)
    project_file.write_text(yaml.safe_dump(data))

    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    called = False
    docker_called = False

    def fake_prepare_project_workspace(**kwargs):
        nonlocal called
        called = True

    def fake_prepare_project_docker(**kwargs):
        nonlocal docker_called
        docker_called = True

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.generate.prepare_project_workspace_stage.prepare_project_workspace",
        fake_prepare_project_workspace,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.generate.prepare_project_docker",
        fake_prepare_project_docker,
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

    assert called
    assert docker_called


def test_generate_writes_ros2_stage_override_scripts(tmp_path):
    project_dir = _clone_fixture(tmp_path)
    model_file = project_dir / "models" / "test-project-brain.model.yaml"
    model_data = yaml.safe_load(model_file.read_text(encoding="utf-8")) or {}
    model_data["runtime"] = {
        "target_platform": "linux",
        "target_variant": "x86_64",
        "custom_stages": {
            "run_command": "./ros2/do_ros2_run.sh",
            "stop_command": "./ros2/do_ros2_stop.sh",
        },
    }
    model_file.write_text(yaml.safe_dump(model_data), encoding="utf-8")

    generate_module.generate(
        "test-project",
        "test-project-brain",
        "linux",
        base_dir=project_dir,
        dry_run=False,
        stub_install=True,
        skip_prepare_project_workspace=True,
        skip_prepare_project_docker=True,
    )

    launcher_dir = (
        project_dir
        / ".launcher"
        / "test_project"
        / "generated"
        / "test_project_brain"
        / "linux"
    )
    run_script = launcher_dir / "do_launcher_run.sh"
    stop_script = launcher_dir / "do_launcher_stop.sh"

    run_contents = run_script.read_text(encoding="utf-8")
    stop_contents = stop_script.read_text(encoding="utf-8")

    assert "Generated by launcher from runtime.custom_stages" in run_contents
    assert "cd \"$PROJECT_DIR\"" in run_contents
    assert "ros2/do_ros2_run.sh" in run_contents
    assert "Generated by launcher from runtime.custom_stages" in stop_contents
    assert "ros2/do_ros2_stop.sh" in stop_contents

    build_script = launcher_dir / "do_launcher_build.sh"
    assert "cmake -S \"$SCRIPT_DIR\" -B \"$BUILD_DIR\"" in build_script.read_text(
        encoding="utf-8"
    )


def test_generate_removes_stale_ros2_stage_script_when_override_removed(tmp_path):
    project_dir = _clone_fixture(tmp_path)
    model_file = project_dir / "models" / "test-project-brain.model.yaml"
    model_data = yaml.safe_load(model_file.read_text(encoding="utf-8")) or {}
    model_data["runtime"] = {
        "target_platform": "linux",
        "target_variant": "x86_64",
        "custom_stages": {
            "run_command": "./ros2/do_ros2_run.sh",
        },
    }
    model_file.write_text(yaml.safe_dump(model_data), encoding="utf-8")

    generate_module.generate(
        "test-project",
        "test-project-brain",
        "linux",
        base_dir=project_dir,
        dry_run=False,
        stub_install=True,
        skip_prepare_project_workspace=True,
        skip_prepare_project_docker=True,
    )

    launcher_dir = (
        project_dir
        / ".launcher"
        / "test_project"
        / "generated"
        / "test_project_brain"
        / "linux"
    )
    run_script = launcher_dir / "do_launcher_run.sh"
    assert run_script.exists()

    model_data["runtime"]["custom_stages"] = {}
    model_file.write_text(yaml.safe_dump(model_data), encoding="utf-8")

    generate_module.generate(
        "test-project",
        "test-project-brain",
        "linux",
        base_dir=project_dir,
        dry_run=False,
        stub_install=True,
        skip_prepare_project_workspace=True,
        skip_prepare_project_docker=True,
    )

    assert not run_script.exists()


def test_copy_extras_for_target_skips_variant_rewrites(monkeypatch, tmp_path):
    copied: list[str] = []
    real_copy2 = shutil.copy2

    def _tracking_copy2(src, dst, *args, **kwargs):
        copied.append(Path(dst).name)
        return real_copy2(src, dst, *args, **kwargs)

    monkeypatch.setattr("robotick.launcher.utils.shutil.copy2", _tracking_copy2)

    launcher_dir = tmp_path / "generated"
    config = SimpleNamespace(
        target="linux",
        launcher_dir=launcher_dir,
        dry_run=False,
    )

    copy_extras_for_target(config, variant="arm64")

    assert sorted(copied) == [
        "do_launcher_build.sh",
        "do_launcher_clean_build.sh",
        "toolchain-linux-arm64.cmake",
    ]
    assert "linux arm64" in (launcher_dir / "do_launcher_build.sh").read_text(encoding="utf-8")

    copied.clear()
    copy_extras_for_target(config, variant="arm64")
    assert copied == []


def test_copy_extras_for_target_supports_arm32_variant(monkeypatch, tmp_path):
    copied: list[str] = []
    real_copy2 = shutil.copy2

    def _tracking_copy2(src, dst, *args, **kwargs):
        copied.append(Path(dst).name)
        return real_copy2(src, dst, *args, **kwargs)

    monkeypatch.setattr("robotick.launcher.utils.shutil.copy2", _tracking_copy2)

    launcher_dir = tmp_path / "generated"
    config = SimpleNamespace(
        target="linux",
        launcher_dir=launcher_dir,
        dry_run=False,
    )

    copy_extras_for_target(config, variant="arm32")

    assert sorted(copied) == [
        "do_launcher_build.sh",
        "do_launcher_clean_build.sh",
        "toolchain-linux-arm32.cmake",
    ]
    assert "linux arm32" in (launcher_dir / "do_launcher_build.sh").read_text(encoding="utf-8")


def test_generate_esp32_build_script_reuses_existing_build_dir(tmp_path):
    project_dir = _clone_fixture(tmp_path)

    generate_module.generate(
        "test-project",
        "test-project-spine",
        "esp32",
        base_dir=project_dir,
        dry_run=False,
        stub_install=True,
        skip_prepare_project_docker=True,
    )

    script_path = (
        project_dir
        / ".launcher"
        / "test_project"
        / "generated"
        / "test_project_spine"
        / "esp32"
        / "do_launcher_build.sh"
    )
    script = script_path.read_text(encoding="utf-8")
    common_setup = script_path.with_name("do_launcher_common_setup.sh").read_text(
        encoding="utf-8"
    )

    assert "rm -rf build sdkconfig sdkconfig.old" in script
    assert "Detected sdkconfig.defaults change; resetting ESP-IDF build state" in script
    assert "Reusing existing build directory" in script
    assert "idf.py set-target" in script
    assert "/opt/esp/idf/export.sh" not in script
    assert "docker exec" in common_setup
    assert "docker create" in common_setup
    assert "--rm" not in common_setup


def test_generate_esp32_run_script_skips_flash_when_checksum_unchanged(tmp_path):
    project_dir = _clone_fixture(tmp_path)

    generate_module.generate(
        "test-project",
        "test-project-spine",
        "esp32",
        base_dir=project_dir,
        dry_run=False,
        stub_install=True,
        skip_prepare_project_docker=True,
    )

    script_path = (
        project_dir
        / ".launcher"
        / "test_project"
        / "generated"
        / "test_project_spine"
        / "esp32"
        / "do_launcher_run.sh"
    )
    script = script_path.read_text(encoding="utf-8")
    common_setup = script_path.with_name("do_launcher_common_setup.sh").read_text(
        encoding="utf-8"
    )

    assert ".last_flashed_image.sha256" in script
    assert "compute_flash_bundle_checksum" in script
    assert "Flash skipped; image checksum unchanged." in script
    assert "esptool.py" in script
    assert "run" in script
    assert "/opt/esp/idf/export.sh" not in script
    assert ". /opt/esp/idf/export.sh >/dev/null &&" in common_setup


def test_project_workspace_hydration_skips_model_dependency_sync_entirely(monkeypatch, tmp_path):
    project_dir = _clone_fixture(tmp_path)
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    sync_calls: list[object] = []

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.project_workspace_hydration._ensure_python_venv",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.project_workspace_hydration._pip_install",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.project_workspace_hydration._discover_site_packages",
        lambda *_: "/tmp/site-packages",
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.project_workspace_hydration._sync_runtime_repo_sources",
        lambda **kwargs: None,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.sync_dependencies.sync_model_dependencies",
        lambda config: sync_calls.append(config),
        raising=False,
    )

    result = project_workspace_hydration.hydrate_project_workspace(
        project="test-project",
        base_dir=project_dir,
        workspace_root=workspace_dir,
        dry_run=False,
        stub_install=True,
        target="linux",
    )

    assert result is not None
    assert sync_calls == []


def test_project_workspace_hydration_only_returns_workspace_state(monkeypatch, tmp_path):
    project_dir = tmp_path / "proj"
    project_dir.mkdir()
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    base_config = SimpleNamespace(
        project_name="proj",
        project_dir=project_dir,
        python_roots=[],
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.project_workspace_hydration._sync_runtime_repo_sources",
        lambda **kwargs: None,
    )

    result = project_workspace_hydration._hydrate_project_workspace_locked(
        config=base_config,
        project="proj",
        base_dir=project_dir,
        workspace_root=workspace_dir,
        dry_run=False,
        stub_install=True,
        model=None,
        target="linux",
    )

    assert result is not None
    assert hasattr(result, "venv_path")
    assert hasattr(result, "lock_path")


def test_runtime_repo_pinning_writes_lock_and_overrides_paths(tmp_path):
    engine_repo = tmp_path / "engine-repo"
    workloads_repo = tmp_path / "workloads-repo"
    engine_ref = _init_git_repo(engine_repo, "CMakeLists.txt")
    workloads_ref = _init_git_repo(workloads_repo, "README.md")

    project_dir = tmp_path / "pip"
    project_dir.mkdir()

    project_yaml = {
        "name": "pip",
        "tooling": {
            "tooling_sources": [
                {"id": "local-tooling", "local_path": "${PROJECT_DIR}"}
            ]
        },
        "runtime": {
            "engine": {
                "id": "engine-src",
                "repo": engine_repo.as_posix(),
                "ref": engine_ref,
            },
            "workload_sources": [
                {
                    "id": "workloads-src",
                    "repo": workloads_repo.as_posix(),
                    "ref": workloads_ref,
                }
            ],
        },
    }
    (project_dir / "pip.project.yaml").write_text(yaml.safe_dump(project_yaml))

    project_workspace_hydration.hydrate_project_workspace(
        project="pip",
        base_dir=project_dir,
        workspace_root=project_dir,
        dry_run=False,
        stub_install=False,
        target="linux",
    )

    runtime_root = project_dir / ".launcher" / "pip" / "deps" / "runtime"
    lock_path = runtime_root / "runtime-lock.json"
    assert lock_path.exists()
    data = json.loads(lock_path.read_text())
    assert data["project"] == "pip"
    target_blob = data["targets"]["linux"]
    engine_entry = target_blob["engine"]
    workload_entries = target_blob["workload_sources"]
    assert engine_entry["repo"] == engine_repo.as_posix()
    assert Path(engine_entry["path"]).name == "engine-src"
    assert workload_entries[0]["repo"] == workloads_repo.as_posix()
    assert "workloads" in workload_entries[0]["path"]

    config = Config("pip", None, "linux", project_dir, False, False)
    assert config.runtime.engine.get("path_override") == engine_entry["path"]
    workload_override = config.runtime.workload_sources[0].get("path_override")
    assert workload_override == workload_entries[0]["path"]
