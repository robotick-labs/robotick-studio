from __future__ import annotations

from typing import Any

from robotick_cli.command_result import CommandResult
from robotick_cli.app.context import AppContext
from robotick_cli.app.errors import CliError, HubRequestError
from robotick_cli.hub_client import (
    HubRecord,
    discover_hub,
    ensure_hub,
    fetch_hub_json,
    is_hub_compatible,
    is_hub_usable,
    is_pid_alive,
    desktop_tray_expected,
)
from robotick_cli.language.help import get_hub_help_text, hub_projects_help_text, hub_status_help_text
from robotick_cli.output import write_json, writeln


def is_help_flag(value: str) -> bool:
    return value in {"--help", "-h", "help"}


def run_hub_command(ctx: AppContext, args: list[str]) -> CommandResult:
    if not args or is_help_flag(args[0]):
        writeln(get_hub_help_text())
        return CommandResult(exit_code=0)

    command, *rest = args
    if command == "status":
        handle_status_command(ctx, rest)
        return CommandResult(exit_code=0)
    if command == "ensure":
        handle_ensure_command(ctx, rest)
        return CommandResult(exit_code=0)
    if command == "projects":
        handle_projects_command(ctx, rest)
        return CommandResult(exit_code=0)
    raise CliError(f"Unknown hub command: {command}")


def handle_status_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(hub_status_help_text())
        return
    unknown_args = [arg for arg in args if arg != "--json"]
    if unknown_args:
        raise CliError(f"Unknown argument for 'hub status': {unknown_args[0]}")

    write_json(build_hub_status_payload(ctx))


def handle_ensure_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln("Usage:\n  robotick hub ensure\n")
        return
    unknown_args = [arg for arg in args if arg != "--json"]
    if unknown_args:
        raise CliError(f"Unknown argument for 'hub ensure': {unknown_args[0]}")

    before = discover_hub(ctx.workspace_root)
    before_healthy = (
        before is not None
        and is_pid_alive(before.pid)
        and is_hub_usable(before, tray_required=desktop_tray_expected())
    )
    action = "reused" if before_healthy else ("restarted" if before is not None else "started")
    record = ensure_hub(ctx.workspace_root)
    write_json(
        {
            "resource_type": "robotick_hub_ensure_result",
            "action": action,
            "status": build_running_hub_status(record),
        }
    )


def build_hub_status_payload(ctx: AppContext) -> dict[str, Any]:
    record = discover_hub(ctx.workspace_root)
    if record is None:
        return {
            "resource_type": "robotick_hub_status",
            "state": "stopped",
            "endpoint": None,
            "pid": None,
            "workspace_root": str(ctx.workspace_root),
            "tray": None,
            "capabilities": [],
        }
    if not is_pid_alive(record.pid):
        return {
            "resource_type": "robotick_hub_status",
            "state": "stale",
            "endpoint": record.endpoint,
            "pid": record.pid,
            "workspace_root": str(ctx.workspace_root),
            "tray": {
                "expected": record.tray_expected,
                "active": record.tray_active,
            },
            "capabilities": [],
        }
    try:
        return build_running_hub_status(record)
    except HubRequestError:
        return {
            "resource_type": "robotick_hub_status",
            "state": "degraded",
            "endpoint": record.endpoint,
            "pid": record.pid,
            "workspace_root": str(ctx.workspace_root),
            "tray": {
                "expected": record.tray_expected,
                "active": record.tray_active,
            },
            "capabilities": [],
        }


def build_running_hub_status(record: HubRecord) -> dict[str, Any]:
    health = fetch_hub_json(record, "/v1/health")
    capabilities = fetch_hub_json(record, "/v1/capabilities")
    return {
        "resource_type": "robotick_hub_status",
        "state": "running",
        "endpoint": record.endpoint,
        "pid": record.pid,
        "workspace_root": health["workspace_root"],
        "protocol": {
            "api_version": health.get("api_version"),
            "features": health.get("features", []),
            "compatible": is_hub_compatible(health),
        },
        "tray": {
            "expected": health.get("tray_expected", False),
            "active": health.get("tray_active", False),
        },
        "capabilities": capabilities["capabilities"],
    }


def handle_projects_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(hub_projects_help_text())
        return
    json_mode = "--json" in args
    unknown_args = [arg for arg in args if arg != "--json"]
    if unknown_args:
        raise CliError(f"Unknown argument for 'hub projects': {unknown_args[0]}")

    record = ensure_hub(ctx.workspace_root)
    payload = fetch_hub_json(record, "/v1/workspace/projects")
    if json_mode:
        write_json(payload)
        return

    writeln("Workspace projects from robotick-hub:")
    for project in payload["projects"]:
        writeln(f"- {project['name']}: {project['project_dir']}")


def get_hub_workspace_projects(ctx: AppContext) -> list[dict[str, str]]:
    record = ensure_hub(ctx.workspace_root)
    payload = fetch_hub_json(record, "/v1/workspace/projects")
    return list(payload["projects"])
