from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from robotick_hub.contracts import WorkspaceProject
from robotick_hub.manifest import load_manifest
from robotick.launcher.actions.query.list import list_project_models


def _read_yaml_file(path: Path) -> dict[str, Any]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(payload, dict):
        return {}
    return payload


def build_workspace_projects(workspace_root: str | Path) -> list[WorkspaceProject]:
    manifest = load_manifest(workspace_root)
    resolved_workspace_root = Path(workspace_root).resolve()
    projects: list[WorkspaceProject] = []
    for name, project in manifest.projects.items():
        project_root = (resolved_workspace_root / project.project_dir).resolve()
        project_files = sorted(project_root.glob("*.project.yaml"))
        project_path = str(project_files[0]) if project_files else None
        display_name = name
        description = None

        if project_path is not None:
            try:
                payload = _read_yaml_file(Path(project_path))
            except Exception:
                payload = {}
            display_name = str(payload.get("name") or "").strip() or name
            description_value = payload.get("description")
            if isinstance(description_value, str):
                description = description_value.strip() or None

        projects.append(
            WorkspaceProject(
                name=name,
                project_dir=project.project_dir,
                project_path=project_path,
                display_name=display_name,
                description=description,
            )
        )
    return projects


def list_workspace_project_paths(workspace_root: str | Path) -> list[str]:
    return sorted(
        project.project_path
        for project in build_workspace_projects(workspace_root)
        if project.project_path
    )


def get_project_settings(project_path: str | Path) -> dict[str, Any]:
    resolved = Path(project_path).resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"Project file not found: {resolved}")
    return _read_yaml_file(resolved)


def get_project_rc_settings(project_path: str | Path) -> dict[str, Any]:
    resolved = Path(project_path).resolve()
    settings_path = resolved.with_name(resolved.name.replace(".project.yaml", ".rc.yaml"))
    if not settings_path.exists():
        return {}
    return _read_yaml_file(settings_path)


def list_project_model_paths(project_path: str | Path) -> list[str]:
    resolved = Path(project_path).resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"Project file not found: {resolved}")
    return list_project_models(str(resolved))


def get_project_model(project_path: str | Path, model_path: str) -> dict[str, Any]:
    resolved_project = Path(project_path).resolve()
    if not resolved_project.exists():
        raise FileNotFoundError(f"Project file not found: {resolved_project}")
    resolved_model = (resolved_project.parent / model_path).resolve()
    try:
        resolved_model.relative_to(resolved_project.parent)
    except ValueError as error:
        raise ValueError("model_path must be under the project folder") from error
    if not resolved_model.exists():
        raise FileNotFoundError(f"Model file not found: {resolved_model}")
    return _read_yaml_file(resolved_model)


def resolve_project_asset_path(project_path: str | Path, asset_path: str) -> Path:
    resolved_project = Path(project_path).resolve()
    if not resolved_project.exists():
        raise FileNotFoundError(f"Project file not found: {resolved_project}")
    candidate = (resolved_project.parent / asset_path).resolve()
    try:
        candidate.relative_to(resolved_project.parent)
    except ValueError as error:
        raise ValueError("asset_path must be under the project folder") from error
    if not candidate.exists() or not candidate.is_file():
        raise FileNotFoundError(f"Asset file not found: {candidate}")
    return candidate
