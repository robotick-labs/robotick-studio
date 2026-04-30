from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, FileResponse
from typing import List, Dict, Any
from pathlib import Path
import yaml
import json
import jsonschema
from jsonschema import Draft4Validator

from robotick.launcher.actions.query.list import list_projects, list_project_models
from robotick.launcher.discover_workloads import discover_workloads_metadata
from robotick.launcher.runtime_lock import apply_runtime_lock

router = APIRouter(prefix="/query", tags=["query"])

_HARDCODED_FIELD_DEFAULTS: Dict[tuple[str, str], str] = {
    ("Vec2f", "x"): "0.0",
    ("Vec2f", "y"): "0.0",
    ("Vec3f", "x"): "0.0",
    ("Vec3f", "y"): "0.0",
    ("Vec3f", "z"): "0.0",
    ("Quatf", "w"): "1.0",
    ("Quatf", "x"): "0.0",
    ("Quatf", "y"): "0.0",
    ("Quatf", "z"): "0.0",
}


class _DiscoveryConfig:
    def __init__(
        self,
        base_dir: Path,
        project_data: Dict[str, Any],
        target: str,
        project_name: str,
    ):
        self.base_dir = base_dir
        self.project = project_data or {}
        self.runtime = self.project.get("runtime", {}) or {}
        self.target = target
        self.target_platform = target
        self.launcher_dir = base_dir / ".launcher"
        self.project_name = project_name
        self.project_name_safe = project_name.replace("-", "_")
        apply_runtime_lock(
            self.runtime,
            self.base_dir,
            self.project_name_safe,
            self.target,
        )

    def resolve_project_path(self, raw: str) -> Path:
        value = str(raw or "").replace("${PROJECT_DIR}", str(self.base_dir))
        path = Path(value)
        if not path.is_absolute():
            path = (self.base_dir / path).resolve()
        else:
            path = path.resolve()
        return path


def _resolve_engine_schema_path(config: _DiscoveryConfig, schema_filename: str) -> Path:
    runtime_engine = (config.runtime or {}).get("engine") or {}
    engine_root = config.resolve_project_path(
        runtime_engine.get("local_path") or runtime_engine.get("path_override") or ""
    )
    candidates = [
        engine_root / "schemas" / schema_filename,
        Path(__file__).resolve().parents[6]
        / "robotick-engine"
        / "schemas"
        / schema_filename,
        Path(__file__).resolve().parents[4]
        / "tests"
        / "test_data"
        / "robotick"
        / "robotick-engine"
        / "schemas"
        / schema_filename,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"Unable to locate engine schema '{schema_filename}' in engine roots. "
        f"Expected at <engine>/schemas/{schema_filename}."
    )


def _load_workloads_layout_schema(config: _DiscoveryConfig) -> Dict[str, Any]:
    schema_path = _resolve_engine_schema_path(config, "workloads_layout.schema.json")
    return json.loads(schema_path.read_text(encoding="utf-8"))


def _load_core_model_schema(config: _DiscoveryConfig) -> Dict[str, Any]:
    schema_path = _resolve_engine_schema_path(config, "core_model_envelope.schema.json")
    return json.loads(schema_path.read_text(encoding="utf-8"))


def _validate_workloads_layout_payload(
    payload: Dict[str, Any], config: _DiscoveryConfig
) -> None:
    schema = _load_workloads_layout_schema(config)
    jsonschema.validate(instance=payload, schema=schema)


def _format_validation_error_path(err: jsonschema.ValidationError) -> str:
    parts: List[str] = []
    for item in err.absolute_path:
        if isinstance(item, int):
            parts.append(f"[{item}]")
        else:
            if parts:
                parts.append(f".{item}")
            else:
                parts.append(str(item))
    return "".join(parts) if parts else "$"


def _validate_core_model_yaml_against_schema(
    config: _DiscoveryConfig, project_path: Path, project_data: Dict[str, Any]
) -> List[str]:
    schema = _load_core_model_schema(config)
    validator = Draft4Validator(schema)
    errors: List[str] = []

    try:
        model_paths = list_project_models(str(project_path.resolve()))
    except Exception:
        model_paths = []

    base_dir = project_path.parent.resolve()
    for rel_path in model_paths:
        model_path = (base_dir / rel_path).resolve()
        if not model_path.exists():
            continue
        model_data = _load_yaml_as_json(model_path)
        for err in validator.iter_errors(model_data):
            errors.append(
                f"{rel_path}:{_format_validation_error_path(err)}: {err.message}"
            )

    return errors


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
        contents = path.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read YAML '{path}': {exc}",
        ) from exc

    try:
        data = yaml.safe_load(contents)
    except yaml.YAMLError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid YAML in '{path}': {exc}"
        ) from exc

    # Normalize `None` (empty files) to an empty object for predictable JSON
    return data if data is not None else {}


def _resolve_project_scoped_path(project_path: Path, relative_path: str) -> Path:
    try:
        project_path_full = project_path.resolve()
    except Exception as exc:  # pragma: no cover - Path.resolve rarely fails
        raise HTTPException(
            status_code=400, detail=f"Invalid project path: {project_path}"
        ) from exc

    if not project_path_full.exists():
        raise HTTPException(
            status_code=404, detail=f"Project file not found: {project_path_full}"
        )

    base_dir = project_path_full.parent.resolve()
    candidate = (base_dir / relative_path).resolve()
    try:
        candidate.relative_to(base_dir)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="asset_path must be under the project folder"
        )
    return candidate


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


@router.api_route(
    "/project-assets/{asset_path:path}",
    methods=["GET", "HEAD"],
    response_class=FileResponse,
)
def get_project_asset(
    asset_path: str,
    project_path: Path = Query(
        ..., description="Absolute path to the project YAML file"
    ),
):
    """
    Read a project asset file (relative to the project folder) and stream it.
    """
    asset_full_path = _resolve_project_scoped_path(project_path, asset_path)
    if not asset_full_path.exists() or not asset_full_path.is_file():
        raise HTTPException(
            status_code=404, detail=f"Asset file not found: {asset_full_path}"
        )

    return FileResponse(path=asset_full_path)


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
    project_name = project_path_full.stem.removesuffix(".project")

    project_data = _load_yaml_as_json(project_path_full)

    discovery_config = _DiscoveryConfig(
        base_dir=base_dir,
        project_data=project_data,
        target=target,
        project_name=project_name,
    )
    validation_errors = _validate_core_model_yaml_against_schema(
        discovery_config, project_path_full, project_data
    )
    discovered = discover_workloads_metadata(discovery_config)

    workloads: List[Dict[str, Any]] = []
    shared_primitives: Dict[str, Dict[str, Any]] = {}
    shared_structs: Dict[str, Dict[str, Any]] = {}
    for entry in discovered:
        metadata = dict(entry)
        primitives = metadata.pop("primitives", {}) or {}
        if isinstance(primitives, dict):
            for tname, pmeta in primitives.items():
                if not isinstance(tname, str) or not isinstance(pmeta, dict):
                    continue
                existing = shared_primitives.get(tname)
                if existing is None:
                    shared_primitives[tname] = dict(pmeta)
                elif existing != pmeta:
                    raise HTTPException(
                        status_code=500,
                        detail=(
                            f"Conflicting primitive metadata for type '{tname}' "
                            f"while building shared workload registry schema."
                        ),
                    )
        structs = metadata.get("structs", {}) or {}
        if isinstance(structs, dict):
            for _, sdef in structs.items():
                if not isinstance(sdef, dict):
                    continue
                sname = sdef.get("name")
                if not isinstance(sname, str) or not sname.strip():
                    continue
                normalized_fields: List[Dict[str, Any]] = []
                for f in sdef.get("fields", []) or []:
                    if not isinstance(f, dict):
                        continue
                    fname = f.get("name")
                    ftype = f.get("type")
                    if not isinstance(fname, str) or not isinstance(ftype, str):
                        continue
                    nfield = {
                        "field_name": fname,
                        "field_type_name": ftype,
                    }
                    if "default_value" in f:
                        nfield["default_value"] = f.get("default_value")
                    normalized_fields.append(nfield)
                normalized = {"type_name": sname, "fields": normalized_fields}
                existing = shared_structs.get(sname)
                if existing is None:
                    shared_structs[sname] = normalized
                elif existing != normalized:
                    raise HTTPException(
                        status_code=500,
                        detail=(
                            f"Conflicting struct metadata for type '{sname}' "
                            f"while building shared workload registry schema."
                        ),
                    )
        workload_entry: Dict[str, Any] = {
            "type": entry["name"],
        }
        for key in ("config", "inputs", "outputs"):
            sdef = structs.get(key)
            if isinstance(sdef, dict) and isinstance(sdef.get("name"), str):
                workload_entry[key] = {"type": sdef["name"]}
        if "schema_error" in metadata:
            workload_entry["schema_error"] = metadata["schema_error"]
            validation_errors.append(
                f"{entry['name']}:$: {metadata['schema_error']}"
            )
        workloads.append(workload_entry)

    types_map: Dict[str, Dict[str, Any]] = {}

    for type_name, meta in shared_primitives.items():
        type_entry = {
            "name": type_name,
            "type_category": meta.get("category", "primitive"),
        }
        for opt_key in (
            "primitive_kind",
            "mime_type",
            "format",
            "capacity",
            "enum_values",
        ):
            if opt_key in meta:
                type_entry[opt_key] = meta[opt_key]
        types_map[type_name] = type_entry

    primitive_kind_by_type: Dict[str, str] = {}
    for primitive_name, primitive_meta in shared_primitives.items():
        primitive_kind = primitive_meta.get("primitive_kind")
        if isinstance(primitive_kind, str):
            primitive_kind_by_type[primitive_name] = primitive_kind

    for type_name, sdef in shared_structs.items():
        fields: List[Dict[str, Any]] = []
        for field in sdef.get("fields", []) or []:
            field_name = field.get("field_name", "")
            field_type = field.get("field_type_name", "")
            field_entry: Dict[str, Any] = {
                "name": field_name,
                "type": field_type,
                "element_count": 1,
            }
            if "default_value" in field:
                field_entry["default_value"] = field.get("default_value")
            else:
                hardcoded_default = _HARDCODED_FIELD_DEFAULTS.get((type_name, field_name))
                if hardcoded_default is not None:
                    field_entry["default_value"] = hardcoded_default
                    fields.append(field_entry)
                    continue
                primitive_kind = primitive_kind_by_type.get(field_type)
                if primitive_kind is not None:
                    validation_errors.append(
                        "Missing default_value in schema metadata for primitive field "
                        f"'{type_name}.{field_name}' ({field_type}, kind={primitive_kind})."
                    )
            primitive_meta = shared_primitives.get(field_type, {})
            if isinstance(primitive_meta, dict):
                primitive_kind = primitive_meta.get("primitive_kind")
                if isinstance(primitive_kind, str):
                    field_entry["primitive_kind"] = primitive_kind
                enum_values = primitive_meta.get("enum_values")
                if (
                    isinstance(enum_values, list)
                    and all(isinstance(v, str) for v in enum_values)
                    and len(enum_values) > 0
                ):
                    field_entry["enum_values"] = enum_values
            fields.append(field_entry)
        types_map[type_name] = {
            "name": type_name,
            "type_category": "struct",
            "fields": fields,
        }

    payload = {
        "project": str(project_path_full),
        "target": target,
        "workloads": sorted(workloads, key=lambda w: str(w.get("name", ""))),
        "types": sorted(types_map.values(), key=lambda t: str(t.get("name", ""))),
        "writable_inputs": [],
        "validation_errors": validation_errors,
    }
    try:
        _validate_workloads_layout_payload(payload, discovery_config)
    except jsonschema.ValidationError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"workloads layout schema validation failed: {exc.message}",
        ) from exc

    return payload


@router.get("/get-core-model-schema", response_class=JSONResponse)
def get_core_model_schema(
    project_path: Path = Query(
        ..., description="Absolute path to the project YAML file"
    ),
    target: str = Query(
        "linux", description="Target platform used for schema resolution"
    ),
):
    project_path_full = project_path.resolve()
    if not project_path_full.exists():
        raise HTTPException(
            status_code=404, detail=f"Project file not found: {project_path_full}"
        )
    base_dir = project_path_full.parent.resolve()
    project_name = project_path_full.stem.removesuffix(".project")
    project_data = _load_yaml_as_json(project_path_full)
    discovery_config = _DiscoveryConfig(
        base_dir=base_dir,
        project_data=project_data,
        target=target,
        project_name=project_name,
    )
    return _load_core_model_schema(discovery_config)
