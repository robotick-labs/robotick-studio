from __future__ import annotations

from robotick_cli.app.context import AppContext
from robotick_cli.app.errors import CliError
from robotick_cli.command_result import CommandResult
from robotick_cli.hub_client import ensure_hub, fetch_hub_json, post_hub_json
from robotick_cli.language.help import (
    get_launcher_help_text,
    launcher_status_help_text,
)
from robotick_cli.output import write_json, writeln


def is_help_flag(value: str) -> bool:
    return value in {"--help", "-h", "help"}


def run_launcher_command(ctx: AppContext, args: list[str]) -> CommandResult:
    if not args or is_help_flag(args[0]):
        writeln(get_launcher_help_text())
        return CommandResult(exit_code=0)

    command, *rest = args
    if command == "status":
        handle_status_command(ctx, rest)
        return CommandResult(exit_code=0)
    raise CliError(f"Unknown launcher command: {command}")


def handle_status_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(launcher_status_help_text())
        return
    json_mode = "--json" in args
    unknown_args = [arg for arg in args if arg != "--json"]
    if unknown_args:
        raise CliError(f"Unknown argument for 'launcher status': {unknown_args[0]}")

    record = ensure_hub(ctx.workspace_root)
    ensure_payload = post_hub_json(record, "/v1/capabilities/launcher/ensure")
    payload = fetch_hub_json(record, "/v1/launcher/status")
    if json_mode:
        write_json(payload)
        return

    writeln("Robotick launcher is available through robotick-hub.")
    writeln(f"Endpoint: {ensure_payload['endpoint']}")
    writeln(f"PID: {ensure_payload['pid']}")
    writeln(f"Capability status: {payload['capability_status']}")
    listener_status = payload.get("listener_status") or {}
    if listener_status:
        writeln(f"Runtime status: {listener_status.get('status', 'unknown')}")
        if listener_status.get("profile"):
            writeln(f"Profile: {listener_status['profile']}")
