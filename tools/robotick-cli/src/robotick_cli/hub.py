from __future__ import annotations

from robotick_cli.app.context import AppContext
from robotick_cli.app.errors import CliError
from robotick_cli.hub_client import ensure_hub, fetch_hub_json
from robotick_cli.language.help import get_hub_help_text, hub_projects_help_text, hub_status_help_text
from robotick_cli.output import write_json, writeln
from robotick_cli.studio import CommandResult


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
    if command == "projects":
        handle_projects_command(ctx, rest)
        return CommandResult(exit_code=0)
    raise CliError(f"Unknown hub command: {command}")


def handle_status_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(hub_status_help_text())
        return
    json_mode = "--json" in args
    unknown_args = [arg for arg in args if arg != "--json"]
    if unknown_args:
        raise CliError(f"Unknown argument for 'hub status': {unknown_args[0]}")

    record = ensure_hub(ctx.workspace_root)
    health = fetch_hub_json(record, "/v1/health")
    capabilities = fetch_hub_json(record, "/v1/capabilities")
    payload = {
        "endpoint": record.endpoint,
        "pid": record.pid,
        "health": health,
        "capabilities": capabilities["capabilities"],
    }
    if json_mode:
        write_json(payload)
        return

    writeln("Robotick hub is ready.")
    writeln(f"Endpoint: {record.endpoint}")
    writeln(f"PID: {record.pid}")
    writeln(f"Workspace: {health['workspace_root']}")
    writeln("Capabilities:")
    for capability in capabilities["capabilities"]:
        writeln(f"- {capability['name']}: {capability['status']}")


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
