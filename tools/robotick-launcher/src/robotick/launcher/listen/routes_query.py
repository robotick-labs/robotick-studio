from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from typing import List, Dict, Any
from pathlib import Path
import yaml

from robotick.launcher.actions.query.list import list_projects, list_project_models
from robotick.launcher.discover_workloads import discover_workloads_metadata

router = APIRouter(prefix="/query", tags=["query"])


class _DiscoveryConfig:
    def __init__(self, base_dir: Path, project_data: Dict[str, Any], target: str):
        self.base_dir = base_dir
        self.project = project_data or {}
        self.target = target
        self.target_platform = target
        self.launcher_dir = base_dir / ".launcher"


@router.get("/list-projects", response_model=List[str])
def get_projects(base_dir: str = "."):
    """List all project YAML files in a given base directory."""
    return list_projects(base_dir)


@router.get("/list-project-models", response_model=List[str])
def get_project_models(
    project_path: Path = Query(
        ..., description="Absolute path to the project YAML file"
    )
) -> list[str]:
    """List all model YAML files associated with a given project file."""
    try:
        project_path_resolved = project_path.resolve()
    except Exception as exc:  # pragma: no cover - Path.resolve rarely fails
        raise HTTPException(
            status_code=400, detail=f"Invalid project path: {project_path}"
        ) from exc

    try:
        return list_project_models(str(project_path_resolved))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _load_yaml_as_json(path: Path) -> dict:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        # Normalize `None` (empty files) to an empty object for predictable JSON
        return data if data is not None else {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse YAML: {e}") from e


@router.get("/get-project-settings", response_class=JSONResponse)
def get_project_json(
    project_path: Path = Query(
        ..., description="Absolute path to the project YAML file"
    ),
):
    """
    Read a project .yaml file from disk and return it as JSON.
    """
    project_path_full = project_path.resolve()
    if not project_path_full.exists():
        raise HTTPException(
            status_code=404, detail=f"Project file not found: {project_path_full}"
        )
    return _load_yaml_as_json(project_path_full)


@router.get("/get-project-rc-settings", response_class=JSONResponse)
def get_project_viewer_json(
    project_path: Path = Query(
        ..., description="Absolute path to the project YAML file"
    ),
):
    """
    Read a project-viewer .yaml file from disk and return it as JSON.
    """
    settings_path_full = project_path.with_name(
        project_path.name.replace(".project.yaml", ".rc.yaml")
    ).resolve()

    if not settings_path_full.exists():
        return {}

    return _load_yaml_as_json(settings_path_full)


@router.get("/get-model", response_class=JSONResponse)
def get_model_json(
    project_path: Path = Query(
        ..., description="Absolute path to the project YAML file"
    ),
    model_path: str = Query(
        ..., description="Relative path to the model YAML, from the project folder"
    ),
):
    """
    Read a model .yaml (relative to the project folder) and return it as JSON.
    """
    base_dir = project_path.parent.resolve()
    model_path_full = (base_dir / model_path).resolve()

    # Guard against path traversal: require the model to live under the project folder
    try:
        model_path_full.relative_to(base_dir)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="model_path must be under the project folder"
        )

    if not model_path_full.exists():
        raise HTTPException(
            status_code=404, detail=f"Model file not found: {model_path_full}"
        )

    return _load_yaml_as_json(model_path_full)


@router.get("/get-workloads-registry", response_class=JSONResponse)
def get_workloads_registry(
    project_path: Path = Query(
        ..., description="Absolute path to the project YAML file"
    ),
    target: str = Query(
        "linux", description="Target platform used for workload discovery"
    ),
):
    """
    Discover workload metadata for a project, including field types and simple default values.
    """
    project_path_full = project_path.resolve()
    if not project_path_full.exists():
        raise HTTPException(
            status_code=404, detail=f"Project file not found: {project_path_full}"
        )

    base_dir = project_path_full.parent.resolve()

    project_data = _load_yaml_as_json(project_path_full)

    discovery_config = _DiscoveryConfig(
        base_dir=base_dir, project_data=project_data, target=target
    )
    discovered = discover_workloads_metadata(discovery_config)

    registry_entries = []
    for entry in discovered:
        registry_entries.append(
            {
                "type": entry["name"],
                "metadata": entry,
            }
        )

    return {
        "project": str(project_path_full),
        "target": target,
        "registry": registry_entries,
    }
