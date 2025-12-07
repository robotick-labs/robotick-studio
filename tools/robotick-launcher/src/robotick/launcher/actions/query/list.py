import fnmatch
import os
from pathlib import Path
from typing import Optional
import typer


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
    return matches


def list_project_models(project_file_path: str) -> list[str]:
    project_path = Path(project_file_path).resolve()

    if not project_path.exists():
        raise FileNotFoundError(f"Project file not found: {project_file_path}")

    project_dir = project_path.parent
    return find_files_by_wildcard("*.model.yaml", str(project_dir))


def list_project_models_for_cli(project_file_path: str):
    try:
        for model in list_project_models(project_file_path):
            print(model)
    except FileNotFoundError as e:
        print(f"[error] {e}")
        raise typer.Exit(code=1)

def list_projects(base_dir: Optional[str] = None) -> list[str]:
    return find_files_by_wildcard("*.project.yaml", base_dir)


def list_projects_for_cli(base_dir: Optional[str] = None) -> None:
    for project in list_projects(base_dir):
        print(project)
