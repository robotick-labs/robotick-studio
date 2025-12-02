import os
from pathlib import Path
from typer.testing import CliRunner

from robotick.launcher.actions.query.list import list_project_models, list_projects
from robotick.launcher.cli import create_app

runner = CliRunner()
app = create_app()

TEST_BASE = Path("tests/test_data/test-project").resolve()
PROJECT_FILE = TEST_BASE / "test-project.project.yaml"


def test_list_project_models_returns_correct_list():
    models = list_project_models(str(PROJECT_FILE))
    
    assert isinstance(models, list)
    assert len(models) == 2, f"Expected 2 models, got {len(models)}: {models}"

    assert any("test-project-brain.model.yaml" in m for m in models), "Brain model not found"
    assert any("test-project-spine.model.yaml" in m for m in models), "Spine model not found"


def test_list_projects_returns_correct_list():
    projects = list_projects(str(TEST_BASE))
    assert isinstance(projects, list)
    assert any("test-project.project.yaml" in p for p in projects)


def test_list_projects_bad_path_returns_empty_list():
    projects = list_projects("bad/path")
    assert isinstance(projects, list)
    assert len(projects) == 0, f"Expected 0 models, got {len(projects)}: {projects}"

def test_list_projects_cli_bad_path_returns_nothing():
    result = runner.invoke(app, [
        "list-projects",
        "--base-dir", "bad/path"
    ])
    
    assert result.exit_code == 0, f"Expected exit code 0, got {result.exit_code}"
    assert result.stdout.strip() == "", f"Expected no output, got:\n{result.stdout}"

def test_list_models_cli():
    result = runner.invoke(app, [
        "list-project-models",
        str(PROJECT_FILE)
    ])
    assert result.exit_code == 0
    assert "test-project-brain.model.yaml" in result.stdout
    assert "test-project-spine.model.yaml" in result.stdout


def test_list_projects_cli():
    result = runner.invoke(app, [
        "list-projects",
        "--base-dir", str(TEST_BASE)
    ])
    assert result.exit_code == 0
    assert "test-project.project.yaml" in result.stdout


def test_list_projects_follow_symlinks(tmp_path):
    source_repo = tmp_path / "source_repo"
    project_file = source_repo / "robots" / "pip-e" / "pip-e.project.yaml"
    project_file.parent.mkdir(parents=True)
    project_file.write_text("# pip-e project\n")

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    symlink_repo = workspace / "robotick-knitware"
    symlink_repo.symlink_to(source_repo, target_is_directory=True)

    projects = list_projects(str(workspace))
    assert "robotick-knitware/robots/pip-e/pip-e.project.yaml" in projects


def test_list_project_models_accepts_relative_path(tmp_path):
    project_dir = tmp_path / "relative-repo"
    project_file = project_dir / "pip.project.yaml"
    model_file = project_dir / "pip.model.yaml"
    project_dir.mkdir()
    project_file.write_text("# pip project")
    model_file.write_text("# pip model")

    cwd = tmp_path / "runner"
    cwd.mkdir()
    working_project_path = os.path.relpath(project_file, cwd)

    original_cwd = os.getcwd()
    os.chdir(cwd)
    try:
        models = list_project_models(working_project_path)
        assert model_file.name in models[0]
    finally:
        os.chdir(original_cwd)


def test_list_project_models_invalid_path_raises():
    invalid_path = str(TEST_BASE / "missing.project.yaml")
    try:
        list_project_models(invalid_path)
        assert False, "Expected FileNotFoundError"
    except FileNotFoundError as e:
        assert "missing.project.yaml" in str(e)


def test_list_project_models_cli_invalid_path():
    result = runner.invoke(app, [
        "list-project-models",
        str(TEST_BASE / "missing.project.yaml")
    ])
    assert result.exit_code == 1
    assert "Project file not found" in result.stdout
