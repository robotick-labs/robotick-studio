from robotick.launcher.utils import render_template, write_text_if_changed
from rich import print


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


def generate_model_cpp(config):
    filename = f"{config.model_name_safe}_model.cpp"

    subdir = getattr(config, "subdir_model_cpp", None)
    path = (
        config.launcher_dir / subdir / filename
        if subdir
        else config.launcher_dir / filename
    )

    workloads, connections, remote_models, telemetry = prepare_codegen_model_data(
        config
    )

    context = {
        "config": config,
        "workloads": workloads,
        "connections": connections,
        "remote_models": remote_models,
        "telemetry": telemetry,
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
        workloads.append(
            {
                **w,
                "var_name": w["name"].replace("-", "_"),
                "config_entries": _flatten_field_entries(w.get("config")),
                "input_entries": _flatten_field_entries(w.get("inputs")),
            }
        )

    connections = []
    for conn in config.model.get("connections", []):
        connections.append({**conn, "var_name": f"conn_{conn['to'].replace('.', '_')}"})

    remote_models = []
    for remote in config.model.get("remote_models", []):
        remote["name_safe"] = remote["name"].replace("-", "_")
        remote_conns = [
            {
                **conn,
                "var_name": f"{remote['name_safe']}_conn_{conn['to_remote'].replace('.', '_')}",
            }
            for conn in remote.get("connections", [])
        ]
        remote_models.append({**remote, "connections": remote_conns})

    # --- Telemetry (single object) ---
    telemetry = dict(config.model.get("telemetry", {}) or {})

    return workloads, connections, remote_models, telemetry
