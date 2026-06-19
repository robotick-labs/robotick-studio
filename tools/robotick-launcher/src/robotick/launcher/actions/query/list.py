import fnmatch
import os
from pathlib import Path
from typing import Optional
import typer
import yaml


def _is_within_launcher(path: Path) -> bool:
    return any(part == ".launcher" for part in path.parts)


def find_files_by_wildcard(wildcard: str, base_dir: Optional[str]) -> list[str]:
    base_path = Path(base_dir).resolve() if base_dir else Path.cwd()
    matches: list[str] = []
    skip_launcher_dirs = not _is_within_launcher(base_path)
    for root, dirs, files in os.walk(base_path, followlinks=True):
        if skip_launcher_dirs:
            dirs[:] = [d for d in dirs if d != ".launcher"]
        for file_name in files:
            if fnmatch.fnmatch(file_name, wildcard):
                full_path = Path(root) / file_name
                matches.append(str(full_path.relative_to(base_path)))
    return sorted(matches)


def list_project_models(project_file_path: str) -> list[str]:
    project_path = Path(project_file_path).resolve()

    if not project_path.exists():
        raise FileNotFoundError(f"Project file not found: {project_file_path}")

    project_dir = project_path.parent
    try:
        project_data = yaml.safe_load(project_path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise ValueError(f"Invalid YAML in project file: {project_path}") from exc

    models = project_data.get("models") if isinstance(project_data, dict) else None
    if not isinstance(models, list):
        raise ValueError(
            f"Project file must declare a top-level 'models' list: {project_path}"
        )

    project_dir_resolved = project_dir.resolve()
    model_paths: list[str] = []
    for index, model in enumerate(models):
        if not isinstance(model, str) or not model.strip():
            raise ValueError(
                f"Project 'models[{index}]' must be a non-empty relative path"
            )

        model_rel_path = Path(model)
        if model_rel_path.is_absolute():
            raise ValueError(
                f"Project 'models[{index}]' must be relative to the project directory"
            )

        model_full_path = (project_dir_resolved / model_rel_path).resolve()
        try:
            normalized_rel_path = model_full_path.relative_to(project_dir_resolved)
        except ValueError as exc:
            raise ValueError(
                f"Project 'models[{index}]' must stay inside the project directory"
            ) from exc

        if not model_full_path.exists():
            raise FileNotFoundError(f"Model file not found: {normalized_rel_path}")

        model_paths.append(normalized_rel_path.as_posix())

    return model_paths


def list_project_models_for_cli(project_file_path: str):
    try:
        for model in list_project_models(project_file_path):
            print(model)
    except (FileNotFoundError, ValueError) as e:
        print(f"[error] {e}")
        raise typer.Exit(code=1)

def list_projects(base_dir: Optional[str] = None) -> list[str]:
    return find_files_by_wildcard("*.project.yaml", base_dir)


def list_projects_for_cli(base_dir: Optional[str] = None) -> None:
    for project in list_projects(base_dir):
        print(project)
