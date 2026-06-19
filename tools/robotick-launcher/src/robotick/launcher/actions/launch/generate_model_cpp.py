import json
from pathlib import Path
import hashlib
import re

from robotick.launcher.utils import render_template, write_text_if_changed
from robotick.launcher.actions.query.list import list_project_models
from rich import print
import yaml


def _sanitize_cpp_identifier(value: str, *, fallback: str = "id") -> str:
    sanitized = re.sub(r"[^0-9A-Za-z_]", "_", str(value or ""))
    sanitized = re.sub(r"_+", "_", sanitized).strip("_")
    if not sanitized:
        sanitized = fallback
    if sanitized[0].isdigit():
        sanitized = f"_{sanitized}"
    return sanitized


# allows both dot-notation and nested dicts for config entries, flattens to list of {"key": "a.b.c", "value": ...}
def _flatten_field_entries(field_values, parent_key=""):
    entries = []
    if not isinstance(field_values, dict):
        return entries

    for key, value in field_values.items():
        key_str = str(key)
        dotted_key = f"{parent_key}.{key_str}" if parent_key else key_str
        if isinstance(value, dict):
            entries.extend(_flatten_field_entries(value, dotted_key))
            continue
        entries.append({"key": dotted_key, "value": value})
    return entries


def _normalize_field_value_for_cpp(value):
    """
    Normalize a Python value to a C++ string-literal-safe payload.
    The returned value is unquoted and ready to place between double quotes.
    """
    if isinstance(value, bool):
        normalized = "true" if value else "false"
    elif value is None:
        normalized = ""
    else:
        normalized = str(value)
    # JSON escaping is compatible with C++ string literal escapes for this usage.
    return json.dumps(normalized)[1:-1]


def _build_render_entries(entries):
    return [
        {
            "key": entry["key"],
            "value_normalized": _normalize_field_value_for_cpp(entry["value"]),
        }
        for entry in entries
    ]


def generate_model_cpp(config):
    filename = f"{config.model_name_safe}_model.cpp"

    subdir = getattr(config, "subdir_model_cpp", None)
    path = (
        config.launcher_dir / subdir / filename
        if subdir
        else config.launcher_dir / filename
    )

    workloads, connections, remote_models, telemetry, telemetry_peers = prepare_codegen_model_data(
        config
    )

    context = {
        "config": config,
        "workloads": workloads,
        "connections": connections,
        "remote_models": remote_models,
        "telemetry": telemetry,
        "telemetry_peers": telemetry_peers,
    }

    if config.dry_run:
        print(f"[yellow]📝 Dry run — would generate model source:[/] {path}")
        return

    try:
        # 🔹 Ensure folder exists
        path.parent.mkdir(parents=True, exist_ok=True)

        contents = render_template("template_model.cpp", context)
        path.parent.mkdir(parents=True, exist_ok=True)
        if not write_text_if_changed(path, contents):
            raise RuntimeError(f"Failed to write {path}")
    except Exception as e:
        print(f"[bold red]❌ Failed to generate:[/] {path}")
        print(f"[red]Reason:[/] {e}")


def prepare_codegen_model_data(config):
    """Prepares Jinja-safe lists for workloads, connections, and remote models."""
    workloads = []
    workload_id_to_var = {}
    for w in config.model.get("workloads", []):
        workload_id = str(w.get("id", "")).strip()
        workload_display_name = str(w.get("name", "")).strip()
        var_name = _sanitize_cpp_identifier(workload_id, fallback="workload")
        workload_id_to_var[workload_id] = var_name
        config_entries = _flatten_field_entries(w.get("config"))
        input_entries = _flatten_field_entries(w.get("inputs"))
        children = []
        for child in w.get("children", []) or []:
            child_id = ""
            if isinstance(child, dict):
                child_id = str(child.get("workload_id", "")).strip()
            elif isinstance(child, str):
                child_id = child
            if child_id:
                children.append(child_id)
        workloads.append(
            {
                **w,
                "children": children,
                "var_name": var_name,
                "display_name_normalized": _normalize_field_value_for_cpp(workload_display_name),
                "config_entries": config_entries,
                "config_entries_render": _build_render_entries(config_entries),
                "input_entries": input_entries,
                "input_entries_render": _build_render_entries(input_entries),
            }
        )

    connections = []
    for conn in config.model.get("connections", []):
        from_path = _endpoint_id_to_name(conn.get("from", ""))
        to_path = _endpoint_id_to_name(conn.get("to", ""))
        connections.append(
            {
                **conn,
                "from": from_path,
                "to": to_path,
                "var_name": f"conn_{to_path.replace('.', '_')}",
            }
        )

    remote_models = _build_remote_models_codegen(config)

    # --- Telemetry (single object) ---
    telemetry = dict(config.model.get("telemetry", {}) or {})
    telemetry_peers = _build_telemetry_peers_codegen(config, telemetry)

    root_ref = config.model.get("root", {}) or {}
    root_id = str(root_ref.get("workload_id", "")).strip() if isinstance(root_ref, dict) else ""
    config.model["root_var_name"] = workload_id_to_var.get(root_id, "")
    return workloads, connections, remote_models, telemetry, telemetry_peers


def _build_telemetry_peers_codegen(config, telemetry):
    if not bool((telemetry or {}).get("is_gateway")):
        return []

    current_model_id = str((config.model or {}).get("id", "")).strip()
    telemetry_peers = []
    for model in _collect_project_models(config):
        model_id = str(model.get("id", "")).strip()
        if not model_id or model_id == current_model_id:
            continue
        model_data = model.get("data", {}) or {}
        model_telemetry = dict(model_data.get("telemetry") or {})
        port = int(model_telemetry.get("port") or 0)
        if port <= 0:
            continue
        model_runtime = dict(model_data.get("runtime") or {})
        host = str(model_runtime.get("preferred_host") or "").strip()
        if not host:
            continue
        telemetry_peers.append(
            {
                "name": model_id,
                "name_safe": _sanitize_cpp_identifier(model_id, fallback="model"),
                "host": host,
                "telemetry_port": port,
                "is_gateway": bool(model_telemetry.get("is_gateway")),
            }
        )
    return telemetry_peers


def _build_remote_models_codegen(config):
    current_remote_models = config.model.get("remote_models", []) or []
    current_model_id = str(config.model.get("id", "")).strip()
    if not current_model_id:
        if getattr(config, "dry_run", False) and not current_remote_models:
            # Allow dry-run generation of minimal models that don't yet define an id.
            return []
        raise ValueError("Model is missing required 'id'")

    for remote in current_remote_models:
        if not isinstance(remote, dict):
            continue
        remote_model_id = str(remote.get("model_id", "")).strip()
        if not remote_model_id:
            raise ValueError(
                "remote_models entries require non-empty 'model_id'"
            )

    project_models = _collect_project_models(config)
    current_remote_config = {}
    for remote in current_remote_models:
        if not isinstance(remote, dict):
            continue
        remote_model_id = str(remote.get("model_id", "")).strip()
        current_remote_config[remote_model_id] = remote

    canonical_edges = _collect_canonical_remote_edges(project_models)
    model_id_to_workload_names = {
        str(model.get("id", "")).strip(): _build_workload_id_to_name_map(
            model.get("data", {}) or {}
        )
        for model in project_models
        if str(model.get("id", "")).strip()
    }

    remote_grouped = {}
    for edge in canonical_edges:
        if edge["source_model_id"] != current_model_id:
            continue
        target_model = edge["target_model_id"]
        group = remote_grouped.setdefault(
            target_model,
            {
                "mode": "",
                "channel": "",
                "connections": [],
            },
        )
        if not group["mode"] and edge.get("mode"):
            group["mode"] = edge["mode"]
        if not group["channel"] and edge.get("channel"):
            group["channel"] = edge["channel"]
        group["connections"].append(
            {
                "from": _endpoint_id_to_name(
                    edge["source_field"],
                ),
                "to_remote": _endpoint_id_to_name(
                    edge["target_field"],
                ),
            }
        )

    remote_models = []
    for target_model_id in sorted(remote_grouped.keys()):
        remote_decl = current_remote_config.get(target_model_id, {})
        remote_name = target_model_id
        name_safe = _sanitize_cpp_identifier(target_model_id, fallback="model")
        remote_conns = []
        for conn in sorted(
            remote_grouped[target_model_id]["connections"],
            key=lambda c: (c["to_remote"], c["from"]),
        ):
            remote_conns.append(
                {
                    **conn,
                    "var_name": (
                        f"{name_safe}_conn_"
                        f"{conn['from'].replace('.', '_')}__to__{conn['to_remote'].replace('.', '_')}"
                    ),
                }
            )
        remote_models.append(
            {
                "name": remote_name,
                "name_safe": name_safe,
                "mode": str(
                    remote_decl.get("mode")
                    or remote_grouped[target_model_id]["mode"]
                    or ""
                ).strip(),
                "channel": str(
                    remote_decl.get("channel")
                    or remote_decl.get("comms_channel")
                    or remote_grouped[target_model_id]["channel"]
                    or ""
                ).strip(),
                "connections": remote_conns,
            }
        )

    return remote_models


def _collect_project_models(config):
    raw_project_file = str(getattr(config, "project_file", "")).strip()
    if not raw_project_file:
        return [
            {
                "name": getattr(config, "model_name", ""),
                "id": str((getattr(config, "model", {}) or {}).get("id", "")).strip(),
                "data": dict(config.model),
            }
        ]

    project_file = Path(raw_project_file)
    if not project_file.exists():
        return [
            {
                "name": getattr(config, "model_name", ""),
                "id": str((getattr(config, "model", {}) or {}).get("id", "")).strip(),
                "data": dict(config.model),
            }
        ]

    project_dir = project_file.parent
    model_rel_paths = list_project_models(str(project_file))
    collected = []
    for rel_path in model_rel_paths:
        model_path = project_dir / rel_path
        model_name = model_path.name.removesuffix(".model.yaml")
        model_data = yaml.safe_load(model_path.read_text()) or {}
        if not isinstance(model_data, dict):
            raise ValueError(f"Model YAML must be a mapping: {model_path}")
        model_id = str(model_data.get("id", "")).strip()
        if not model_id:
            model_id = f"{model_name.replace('-', '_')}_model_{_stable_suffix(model_name)}"
        collected.append({"name": model_name, "id": model_id, "data": model_data})
    return collected


def _collect_canonical_remote_edges(project_models):
    edge_index = {}
    canonical_edges = []
    for model in project_models:
        model_name = str(model.get("name", "")).strip()
        model_id = str(model.get("id", "")).strip()
        data = model.get("data", {}) or {}
        remote_models = data.get("remote_models", [])
        if not isinstance(remote_models, list):
            continue
        for remote in remote_models:
            if not isinstance(remote, dict):
                continue
            remote_id = str(remote.get("model_id", "")).strip()
            if not remote_id:
                raise ValueError(
                    f"Remote model entry in '{model_name}' is missing required 'model_id'"
                )
            connections = remote.get("connections", [])
            if not isinstance(connections, list):
                continue
            for conn in connections:
                edge = _parse_canonical_remote_edge(
                    model_name,
                    model_id,
                    remote_id,
                    conn,
                    mode=str(remote.get("mode", "")).strip(),
                    channel=str(
                        remote.get("channel") or remote.get("comms_channel") or ""
                    ).strip(),
                )
                if edge is None:
                    continue
                key = (
                    edge["source_model_id"],
                    edge["source_field"],
                    edge["target_model_id"],
                    edge["target_field"],
                )
                existing = edge_index.get(key)
                if existing is not None:
                    raise ValueError(
                        "Duplicate remote connection declaration for "
                        f"{edge['source_model_id']}.{edge['source_field']} -> "
                        f"{edge['target_model_id']}.{edge['target_field']}. "
                        f"Declared in both '{existing['declared_in_model']}' and '{edge['declared_in_model']}'."
                    )
                edge_index[key] = edge
                canonical_edges.append(edge)
    return canonical_edges


def _parse_canonical_remote_edge(
    owner_model_name, owner_model_id, remote_model_id, conn, *, mode="", channel=""
):
    if not isinstance(conn, dict):
        return None

    has_sender_form = ("from_local" in conn) or ("to_remote" in conn)
    has_receiver_form = ("from_remote" in conn) or ("to_local" in conn)

    if has_sender_form and has_receiver_form:
        raise ValueError(
            f"Invalid remote connection in '{owner_model_name}' for remote model "
            f"'{remote_model_id}': cannot mix sender-form (from/to_remote) with "
            "receiver-form (from_remote/to)."
        )

    if has_sender_form:
        source_field = str(conn.get("from_local", "")).strip()
        target_field = str(conn.get("to_remote", "")).strip()
        if not source_field or not target_field:
            raise ValueError(
                f"Invalid remote connection in '{owner_model_name}' for remote model "
                f"'{remote_model_id}': sender-form requires both 'from_local' and 'to_remote'."
            )
        return {
            "source_model": owner_model_name,
            "source_model_id": owner_model_id,
            "source_field": source_field,
            "target_model_id": remote_model_id,
            "target_field": target_field,
            "declared_in_model": owner_model_name,
            "mode": mode,
            "channel": channel,
        }

    if has_receiver_form:
        source_field = str(conn.get("from_remote", "")).strip()
        target_field = str(conn.get("to_local", "")).strip()
        if not source_field or not target_field:
            raise ValueError(
                f"Invalid remote connection in '{owner_model_name}' for remote model "
                f"'{remote_model_id}': receiver-form requires both 'from_remote' and 'to_local'."
            )
        return {
            "source_model_id": remote_model_id,
            "source_field": source_field,
            "target_model_id": owner_model_id,
            "target_field": target_field,
            "declared_in_model": owner_model_name,
            "mode": mode,
            "channel": channel,
        }

    raise ValueError(
        f"Invalid remote connection in '{owner_model_name}' for remote model "
        f"'{remote_model_id}': expected sender-form (from_local/to_remote) or "
        "receiver-form (from_remote/to_local)."
    )


def _endpoint_id_to_name(path):
    raw = str(path or "").strip()
    if not raw:
        return raw
    owner, dot, rest = raw.partition(".")
    return f"{owner}{dot}{rest}" if dot else owner


def _stable_suffix(value):
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:8].upper()


def _build_workload_id_to_name_map(model_data):
    mapping = {}
    for workload in (model_data.get("workloads", []) or []):
        if not isinstance(workload, dict):
            continue
        workload_id = str(workload.get("id", "")).strip()
        if not workload_id:
            continue
        mapping[workload_id] = workload_id
    return mapping
