from pathlib import Path

from typer.testing import CliRunner

from robotick.launcher.cli import create_app


runner = CliRunner()
app = create_app()


def _make_paths(base_dir: Path):
    project = "pip-e"
    model = "pip-e-brain"
    target = "linux"
    project_safe = project.replace("-", "_")
    model_safe = model.replace("-", "_")
    generated = (
        base_dir
        / ".launcher"
        / project_safe
        / "generated"
        / model_safe
        / target
    )
    runtime = base_dir / ".launcher" / project_safe / "deps" / "runtime" / target
    python_lock = (
        base_dir
        / ".launcher"
        / project_safe
        / "deps"
        / "python"
        / "python-roots-lock.json"
    )
    runtime_lock = runtime.parent / "runtime-lock.json"
    install_lock = runtime.parent / ".install.lock"
    return project, model, target, generated, runtime, runtime_lock, install_lock, python_lock


def test_clean_generated_removes_launcher_dir(tmp_path):
    base_dir = tmp_path / "repo"
    base_dir.mkdir()
    project, model, target, generated_dir, *_ = _make_paths(base_dir)
    (generated_dir / "dummy").parent.mkdir(parents=True, exist_ok=True)
    (generated_dir / "dummy.txt").write_text("bin", encoding="utf-8")

    result = runner.invoke(
        app,
        [
            "clean",
            "generated",
            project,
            model,
            target,
            "--base-dir",
            str(base_dir),
        ],
    )
    assert result.exit_code == 0, result.output
    assert not generated_dir.exists()


def test_clean_deps_optionally_removes_generated(tmp_path):
    base_dir = tmp_path / "repo"
    base_dir.mkdir()
    project, model, target, generated_dir, runtime_dir, *_ = _make_paths(base_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    (runtime_dir / "README.md").write_text("deps", encoding="utf-8")
    generated_dir.mkdir(parents=True, exist_ok=True)

    # First pass: only deps removed
    result = runner.invoke(
        app,
        [
            "clean",
            "deps",
            project,
            model,
            target,
            "--base-dir",
            str(base_dir),
        ],
    )
    assert result.exit_code == 0, result.output
    assert not runtime_dir.exists()
    assert generated_dir.exists()

    # Recreate and test cascade to generated artefacts
    runtime_dir.mkdir(parents=True, exist_ok=True)
    generated_dir.mkdir(parents=True, exist_ok=True)
    result = runner.invoke(
        app,
        [
            "clean",
            "deps",
            project,
            model,
            target,
            "--base-dir",
            str(base_dir),
            "--clean-generated",
        ],
    )
    assert result.exit_code == 0, result.output
    assert not runtime_dir.exists()
    assert not generated_dir.exists()


def test_clean_all_removes_locks_and_dirs(tmp_path):
    base_dir = tmp_path / "repo"
    base_dir.mkdir()
    (
        project,
        model,
        target,
        generated_dir,
        runtime_dir,
        runtime_lock,
        install_lock,
        python_lock,
    ) = _make_paths(base_dir)

    generated_dir.mkdir(parents=True, exist_ok=True)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    runtime_lock.write_text("{}", encoding="utf-8")
    install_lock.write_text("1234", encoding="utf-8")
    python_lock.parent.mkdir(parents=True, exist_ok=True)
    python_lock.write_text("{}", encoding="utf-8")

    result = runner.invoke(
        app,
        [
            "clean",
            "all",
            project,
            model,
            target,
            "--base-dir",
            str(base_dir),
        ],
    )
    assert result.exit_code == 0, result.output
    assert not runtime_dir.exists()
    assert not generated_dir.exists()
    assert not runtime_lock.exists()
    assert not install_lock.exists()
    assert not python_lock.exists()
