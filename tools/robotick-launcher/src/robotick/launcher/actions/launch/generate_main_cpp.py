from pathlib import Path
from rich import print
from robotick.launcher.utils import render_template, write_text_if_changed


def _prepare_network_context(config):
    project_network = dict(
        (((config.project or {}).get("runtime") or {}).get("robot_network") or {})
    )
    model_runtime = dict(((config.model or {}).get("runtime") or {}))
    model_network = dict(model_runtime.get("network") or {})
    role = str(model_network.get("role") or "").strip()
    if not role:
        return None

    hotspot = dict(project_network.get("hotspot") or {})
    client = dict(project_network.get("client") or {})
    return {
        "role": role,
        "ssid": str(project_network.get("ssid") or "").strip(),
        "password": str(project_network.get("password") or "").strip(),
        "hotspot_iface": str(hotspot.get("iface") or "wlan0").strip(),
        "hotspot_connection_name": str(
            hotspot.get("connection_name") or "robotick-hotspot"
        ).strip(),
        "hotspot_ipv4_address_cidr": str(
            hotspot.get("ipv4_address_cidr") or "10.42.0.1/24"
        ).strip(),
        "client_static_ipv4": str(client.get("static_ipv4") or "").strip(),
        "client_gateway_ipv4": str(client.get("gateway_ipv4") or "").strip(),
        "client_netmask_ipv4": str(client.get("netmask_ipv4") or "").strip(),
    }


def generate_main_cpp(config):
    """
    Generate the main entrypoint source file using a Jinja2 template. 
    """
    filename = f"{config.model_name_safe}_main.cpp"
    
    subdir = getattr(config, "subdir_main_cpp", None)
    path = config.launcher_dir / subdir / filename if subdir else config.launcher_dir / filename

    context = {
        "model_name": config.model_name,
        "model_name_safe": config.model_name_safe,
        "filename": filename,
        "config": config,
        "network": _prepare_network_context(config),
    }

    if config.dry_run:
        print(f"[yellow]📝 Dry run — would create main source file:[/] {path}")
        return

    try:
        # 🔹 Ensure folder exists
        path.parent.mkdir(parents=True, exist_ok=True)
        
        template_file_name = f"template_main_{config.target}.cpp"
        contents = render_template(template_file_name, context)
        if not write_text_if_changed(path, contents):
            raise RuntimeError(f"Failed to write {path}")
    except FileNotFoundError as e:
        print(f"[bold red]❌ Template error:[/] {e}")
    except Exception as e:
        print(f"[bold red]❌ Failed to write file:[/] {path}")
        print(f"[red]Reason:[/] {e}")
