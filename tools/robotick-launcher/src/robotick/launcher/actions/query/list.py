from pathlib import Path
from typing import Optional


def find_files_by_wildcard(wildcard: str, base_dir: Optional[str]) -> list[str]:
    base_path = Path(base_dir).resolve() if base_dir else Path.cwd()
    return [str(p.relative_to(base_path)) for p in base_path.rglob(wildcard)]


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
