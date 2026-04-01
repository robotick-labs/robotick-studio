import json
from pathlib import Path

from robotick.launcher.utils import render_template, write_text_if_changed
from robotick.launcher.actions.query.list import list_project_models
from rich import print
import yaml


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
    for w in config.model.get("workloads", []):
        config_entries = _flatten_field_entries(w.get("config"))
        input_entries = _flatten_field_entries(w.get("inputs"))
        workloads.append(
            {
                **w,
                "var_name": w["name"].replace("-", "_"),
                "config_entries": config_entries,
                "config_entries_render": _build_render_entries(config_entries),
                "input_entries": input_entries,
                "input_entries_render": _build_render_entries(input_entries),
            }
        )

    connections = []
    for conn in config.model.get("connections", []):
        connections.append({**conn, "var_name": f"conn_{conn['to'].replace('.', '_')}"})

    remote_models = _build_remote_models_codegen(config)

    # --- Telemetry (single object) ---
    telemetry = dict(config.model.get("telemetry", {}) or {})
    telemetry_peers = _build_telemetry_peers_codegen(config, telemetry)

    return workloads, connections, remote_models, telemetry, telemetry_peers


def _build_telemetry_peers_codegen(config, telemetry):
    if not bool((telemetry or {}).get("is_gateway")):
        return []

    current_model_name = getattr(config, "model_name", "") or ""
    telemetry_peers = []
    for model in _collect_project_models(config):
        model_name = str(model.get("name", "")).strip()
        if not model_name or model_name == current_model_name:
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
                "name": model_name,
                "name_safe": model_name.replace("-", "_"),
                "host": host,
                "telemetry_port": port,
                "is_gateway": bool(model_telemetry.get("is_gateway")),
            }
        )
    return telemetry_peers


def _build_remote_models_codegen(config):
    current_model_name = getattr(config, "model_name", "") or ""
    if not current_model_name:
        # Backward-compatible fallback used by some unit tests.
        return _build_remote_models_from_current_model_only(config.model)

    current_remote_config = {
        str(remote.get("name", "")).strip(): remote
        for remote in (config.model.get("remote_models", []) or [])
        if isinstance(remote, dict) and str(remote.get("name", "")).strip()
    }

    project_models = _collect_project_models(config)
    canonical_edges = _collect_canonical_remote_edges(project_models)

    remote_grouped = {}
    for edge in canonical_edges:
        if edge["source_model"] != current_model_name:
            continue
        target_model = edge["target_model"]
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
                "from": edge["source_field"],
                "to_remote": edge["target_field"],
            }
        )

    remote_models = []
    for target_model_name in sorted(remote_grouped.keys()):
        remote_decl = current_remote_config.get(target_model_name, {})
        name_safe = target_model_name.replace("-", "_")
        remote_conns = []
        for conn in sorted(
            remote_grouped[target_model_name]["connections"],
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
                "name": target_model_name,
                "name_safe": name_safe,
                "mode": str(
                    remote_decl.get("mode")
                    or remote_grouped[target_model_name]["mode"]
                    or ""
                ).strip(),
                "channel": str(
                    remote_decl.get("channel")
                    or remote_decl.get("comms_channel")
                    or remote_grouped[target_model_name]["channel"]
                    or ""
                ).strip(),
                "connections": remote_conns,
            }
        )

    return remote_models


def _build_remote_models_from_current_model_only(model):
    remote_models = []
    for remote in model.get("remote_models", []):
        remote_name = str(remote.get("name", "")).strip()
        if not remote_name:
            continue
        name_safe = remote_name.replace("-", "_")
        remote_conns = []
        for conn in remote.get("connections", []):
            source_path = str(conn.get("from", "")).strip()
            dest_path = str(conn.get("to_remote", "")).strip()
            if not source_path or not dest_path:
                continue
            remote_conns.append(
                {
                    "from": source_path,
                    "to_remote": dest_path,
                    "var_name": (
                        f"{name_safe}_conn_"
                        f"{source_path.replace('.', '_')}__to__{dest_path.replace('.', '_')}"
                    ),
                }
            )
        remote_models.append(
            {
                "name": remote_name,
                "name_safe": name_safe,
                "mode": str(remote.get("mode", "")).strip(),
                "channel": str(
                    remote.get("channel") or remote.get("comms_channel") or ""
                ).strip(),
                "connections": remote_conns,
            }
        )
    return remote_models


def _collect_project_models(config):
    project_file = Path(getattr(config, "project_file", ""))
    if not project_file or not project_file.exists():
        return [
            {
                "name": getattr(config, "model_name", ""),
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
        collected.append({"name": model_name, "data": model_data})
    return collected


def _collect_canonical_remote_edges(project_models):
    edge_index = {}
    canonical_edges = []
    for model in project_models:
        model_name = str(model.get("name", "")).strip()
        data = model.get("data", {}) or {}
        remote_models = data.get("remote_models", [])
        if not isinstance(remote_models, list):
            continue
        for remote in remote_models:
            if not isinstance(remote, dict):
                continue
            remote_name = str(remote.get("name", "")).strip()
            if not remote_name:
                continue
            connections = remote.get("connections", [])
            if not isinstance(connections, list):
                continue
            for conn in connections:
                edge = _parse_canonical_remote_edge(
                    model_name,
                    remote_name,
                    conn,
                    mode=str(remote.get("mode", "")).strip(),
                    channel=str(
                        remote.get("channel") or remote.get("comms_channel") or ""
                    ).strip(),
                )
                if edge is None:
                    continue
                key = (
                    edge["source_model"],
                    edge["source_field"],
                    edge["target_model"],
                    edge["target_field"],
                )
                existing = edge_index.get(key)
                if existing is not None:
                    raise ValueError(
                        "Duplicate remote connection declaration for "
                        f"{edge['source_model']}.{edge['source_field']} -> "
                        f"{edge['target_model']}.{edge['target_field']}. "
                        f"Declared in both '{existing['declared_in_model']}' and '{edge['declared_in_model']}'."
                    )
                edge_index[key] = edge
                canonical_edges.append(edge)
    return canonical_edges


def _parse_canonical_remote_edge(
    owner_model_name, remote_model_name, conn, *, mode="", channel=""
):
    if not isinstance(conn, dict):
        return None

    has_sender_form = ("from" in conn) or ("to_remote" in conn)
    has_receiver_form = ("from_remote" in conn) or ("to" in conn)

    if has_sender_form and has_receiver_form:
        raise ValueError(
            f"Invalid remote connection in '{owner_model_name}' for remote model "
            f"'{remote_model_name}': cannot mix sender-form (from/to_remote) with "
            "receiver-form (from_remote/to)."
        )

    if has_sender_form:
        source_field = str(conn.get("from", "")).strip()
        target_field = str(conn.get("to_remote", "")).strip()
        if not source_field or not target_field:
            raise ValueError(
                f"Invalid remote connection in '{owner_model_name}' for remote model "
                f"'{remote_model_name}': sender-form requires both 'from' and 'to_remote'."
            )
        return {
            "source_model": owner_model_name,
            "source_field": source_field,
            "target_model": remote_model_name,
            "target_field": target_field,
            "declared_in_model": owner_model_name,
            "mode": mode,
            "channel": channel,
        }

    if has_receiver_form:
        source_field = str(conn.get("from_remote", "")).strip()
        target_field = str(conn.get("to", "")).strip()
        if not source_field or not target_field:
            raise ValueError(
                f"Invalid remote connection in '{owner_model_name}' for remote model "
                f"'{remote_model_name}': receiver-form requires both 'from_remote' and 'to'."
            )
        return {
            "source_model": remote_model_name,
            "source_field": source_field,
            "target_model": owner_model_name,
            "target_field": target_field,
            "declared_in_model": owner_model_name,
            "mode": mode,
            "channel": channel,
        }

    raise ValueError(
        f"Invalid remote connection in '{owner_model_name}' for remote model "
        f"'{remote_model_name}': expected sender-form (from/to_remote) or "
        "receiver-form (from_remote/to)."
    )
