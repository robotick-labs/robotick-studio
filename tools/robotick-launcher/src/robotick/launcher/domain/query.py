from __future__ import annotations

from pathlib import Path
from typing import Any
import json

import jsonschema
from jsonschema import Draft4Validator
import yaml

from robotick.launcher.actions.query.list import list_project_models
from robotick.launcher.discover_workloads import discover_workloads_metadata
from robotick.launcher.runtime_lock import apply_runtime_lock

_HARDCODED_FIELD_DEFAULTS: dict[tuple[str, str], str] = {
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


def _synthesized_primitive_default(primitive_kind: str) -> str | None:
    if primitive_kind == "string":
        return ""
    return None


class DiscoveryConfig:
    def __init__(
        self,
        base_dir: Path,
        project_data: dict[str, Any],
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


def load_yaml_as_json(path: Path) -> dict[str, Any]:
    contents = path.read_text(encoding="utf-8")
    data = yaml.safe_load(contents)
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ValueError(f"Expected YAML mapping in {path}")
    return data


def resolve_project_scoped_path(project_path: Path, relative_path: str) -> Path:
    project_path_full = project_path.resolve()
    base_dir = project_path_full.parent.resolve()
    candidate = (base_dir / relative_path).resolve()
    try:
        candidate.relative_to(base_dir)
    except ValueError as error:
        raise ValueError("asset_path must be under the project folder") from error
    return candidate


def _resolve_engine_schema_path(config: DiscoveryConfig, schema_filename: str) -> Path:
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


def load_workloads_layout_schema(config: DiscoveryConfig) -> dict[str, Any]:
    schema_path = _resolve_engine_schema_path(config, "workloads_layout.schema.json")
    return json.loads(schema_path.read_text(encoding="utf-8"))


def load_core_model_schema(config: DiscoveryConfig) -> dict[str, Any]:
    schema_path = _resolve_engine_schema_path(config, "core_model_envelope.schema.json")
    return json.loads(schema_path.read_text(encoding="utf-8"))


def _validate_workloads_layout_payload(payload: dict[str, Any], config: DiscoveryConfig) -> None:
    schema = load_workloads_layout_schema(config)
    jsonschema.validate(instance=payload, schema=schema)


def _format_validation_error_path(err: jsonschema.ValidationError) -> str:
    parts: list[str] = []
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
    config: DiscoveryConfig, project_path: Path
) -> list[str]:
    schema = load_core_model_schema(config)
    validator = Draft4Validator(schema)
    errors: list[str] = []
    model_paths = list_project_models(str(project_path.resolve()))
    base_dir = project_path.parent.resolve()
    for rel_path in model_paths:
        model_path = (base_dir / rel_path).resolve()
        if not model_path.exists():
            continue
        model_data = load_yaml_as_json(model_path)
        for err in validator.iter_errors(model_data):
            errors.append(f"{rel_path}:{_format_validation_error_path(err)}: {err.message}")
    return errors


def build_workloads_registry(project_path: Path, target: str = "linux") -> dict[str, Any]:
    project_path_full = project_path.resolve()
    if not project_path_full.exists():
        raise FileNotFoundError(f"Project file not found: {project_path_full}")

    base_dir = project_path_full.parent.resolve()
    project_name = project_path_full.stem.removesuffix(".project")
    project_data = load_yaml_as_json(project_path_full)
    discovery_config = DiscoveryConfig(
        base_dir=base_dir,
        project_data=project_data,
        target=target,
        project_name=project_name,
    )
    validation_errors = _validate_core_model_yaml_against_schema(discovery_config, project_path_full)
    discovered = discover_workloads_metadata(discovery_config)

    workloads: list[dict[str, Any]] = []
    shared_primitives: dict[str, dict[str, Any]] = {}
    shared_structs: dict[str, dict[str, Any]] = {}
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
                    raise RuntimeError(
                        f"Conflicting primitive metadata for type '{tname}' while building shared workload registry schema."
                    )
        structs = metadata.get("structs", {}) or {}
        if isinstance(structs, dict):
            for _, sdef in structs.items():
                if not isinstance(sdef, dict):
                    continue
                sname = sdef.get("name")
                if not isinstance(sname, str) or not sname.strip():
                    continue
                normalized_fields: list[dict[str, Any]] = []
                for field in sdef.get("fields", []) or []:
                    if not isinstance(field, dict):
                        continue
                    fname = field.get("name")
                    ftype = field.get("type")
                    if not isinstance(fname, str) or not isinstance(ftype, str):
                        continue
                    normalized_field = {
                        "field_name": fname,
                        "field_type_name": ftype,
                    }
                    if "default_value" in field:
                        normalized_field["default_value"] = field.get("default_value")
                    normalized_fields.append(normalized_field)
                normalized = {"type_name": sname, "fields": normalized_fields}
                existing = shared_structs.get(sname)
                if existing is None:
                    shared_structs[sname] = normalized
                elif existing != normalized:
                    raise RuntimeError(
                        f"Conflicting struct metadata for type '{sname}' while building shared workload registry schema."
                    )
        workload_entry: dict[str, Any] = {"type": entry["name"]}
        for key in ("config", "inputs", "outputs"):
            sdef = structs.get(key)
            if isinstance(sdef, dict) and isinstance(sdef.get("name"), str):
                workload_entry[key] = {"type": sdef["name"]}
        if "schema_error" in metadata:
            workload_entry["schema_error"] = metadata["schema_error"]
            validation_errors.append(f"{entry['name']}:$: {metadata['schema_error']}")
        workloads.append(workload_entry)

    types_map: dict[str, dict[str, Any]] = {}
    for type_name, meta in shared_primitives.items():
        type_entry = {
            "name": type_name,
            "type_category": meta.get("category", "primitive"),
        }
        for opt_key in ("primitive_kind", "mime_type", "format", "capacity", "enum_values"):
            if opt_key in meta:
                type_entry[opt_key] = meta[opt_key]
        types_map[type_name] = type_entry

    primitive_kind_by_type: dict[str, str] = {}
    for primitive_name, primitive_meta in shared_primitives.items():
        primitive_kind = primitive_meta.get("primitive_kind")
        if isinstance(primitive_kind, str):
            primitive_kind_by_type[primitive_name] = primitive_kind

    for type_name, sdef in shared_structs.items():
        fields: list[dict[str, Any]] = []
        for field in sdef.get("fields", []) or []:
            field_name = field.get("field_name", "")
            field_type = field.get("field_type_name", "")
            field_entry: dict[str, Any] = {
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
                    synthesized_default = _synthesized_primitive_default(primitive_kind)
                    if synthesized_default is not None:
                        field_entry["default_value"] = synthesized_default
                    else:
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
                if isinstance(enum_values, list) and all(isinstance(v, str) for v in enum_values) and enum_values:
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
        "workloads": sorted(workloads, key=lambda item: str(item.get("type", ""))),
        "types": sorted(types_map.values(), key=lambda item: str(item.get("name", ""))),
        "writable_inputs": [],
        "validation_errors": validation_errors,
    }
    _validate_workloads_layout_payload(payload, discovery_config)
    return payload


def get_core_model_schema(project_path: Path, target: str = "linux") -> dict[str, Any]:
    project_path_full = project_path.resolve()
    if not project_path_full.exists():
        raise FileNotFoundError(f"Project file not found: {project_path_full}")
    base_dir = project_path_full.parent.resolve()
    project_name = project_path_full.stem.removesuffix(".project")
    project_data = load_yaml_as_json(project_path_full)
    discovery_config = DiscoveryConfig(
        base_dir=base_dir,
        project_data=project_data,
        target=target,
        project_name=project_name,
    )
    return load_core_model_schema(discovery_config)
