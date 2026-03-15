from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

from robotick.launcher.actions.launch import install_deps, generate as generate_module
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


def test_install_deps_no_python_roots_is_noop(tmp_path):
    project_dir = _clone_fixture(tmp_path)
    project_file = project_dir / "test-project.project.yaml"
    data = yaml.safe_load(project_file.read_text())
    runtime = data.get("runtime")
    if isinstance(runtime, dict):
        runtime.pop("python_roots", None)
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
    assert captured["kwargs"]["model"] == "test-project-brain"
    assert captured["kwargs"]["target"] == "linux"


def test_generate_calls_install_deps_even_without_python(monkeypatch, tmp_path):
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

    assert called


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


def test_generate_esp32_build_script_reuses_existing_build_dir(tmp_path):
    project_dir = _clone_fixture(tmp_path)

    generate_module.generate(
        "test-project",
        "test-project-spine",
        "esp32",
        base_dir=project_dir,
        dry_run=False,
        stub_install=True,
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

    assert "rm -rf build" not in script
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


def test_install_deps_reports_missing_apt(monkeypatch, tmp_path):
    project_dir = _clone_fixture(tmp_path)
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.install_deps._ensure_python_venv",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.install_deps._pip_install",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.install_deps._discover_site_packages",
        lambda *_: "/tmp/site-packages",
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.install_deps.sync_model_dependencies",
        lambda config: ([], ["cmake", "git"]),
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.install_deps._find_missing_apt_packages",
        lambda pkgs: {"git"},
    )

    result = install_deps.install_deps(
        project="test-project",
        base_dir=project_dir,
        workspace_root=workspace_dir,
        dry_run=False,
        stub_install=True,
    )

    assert result is not None
    assert result.apt_packages == ["cmake", "git"]
    assert result.missing_apt == ["git"]


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

    install_deps.install_deps(
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
