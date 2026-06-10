from __future__ import annotations

from typing import Any

from robotick_cli.app.context import AppContext
from robotick_cli.app.errors import CliError, HubRequestError
from robotick_cli.command_result import CommandResult
from robotick_cli.hub_client import (
    HubRecord,
    discover_hub,
    ensure_hub,
    fetch_hub_json,
    is_pid_alive,
    post_hub_json,
)
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
    if command == "ensure":
        handle_ensure_command(ctx, rest)
        return CommandResult(exit_code=0)
    raise CliError(f"Unknown launcher command: {command}")


def handle_status_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(launcher_status_help_text())
        return
    unknown_args = [arg for arg in args if arg != "--json"]
    if unknown_args:
        raise CliError(f"Unknown argument for 'launcher status': {unknown_args[0]}")

    write_json(fetch_read_only_launcher_status(ctx))


def handle_ensure_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln("Usage:\n  robotick launcher ensure\n")
        return
    unknown_args = [arg for arg in args if arg != "--json"]
    if unknown_args:
        raise CliError(f"Unknown argument for 'launcher ensure': {unknown_args[0]}")

    record = ensure_hub(ctx.workspace_root)
    before = fetch_launcher_status_through_hub(record)
    before_state = str(before.get("capability_status") or "stopped")
    action = "reused" if before_state == "healthy" else (
        "started" if before_state == "stopped" else "restarted"
    )
    post_hub_json(record, "/v1/capabilities/launcher/ensure")
    payload = fetch_hub_json(record, "/v1/launcher/status")
    write_json(
        {
            "resource_type": "robotick_launcher_ensure_result",
            "action": action,
            "status": format_launcher_status_payload(payload),
        }
    )


def fetch_read_only_launcher_status(ctx: AppContext) -> dict[str, Any]:
    record = discover_hub(ctx.workspace_root)
    if record is None or not is_pid_alive(record.pid):
        return unavailable_launcher_status()
    try:
        payload = fetch_launcher_status_through_hub(record)
    except HubRequestError:
        return unavailable_launcher_status()
    return format_launcher_status_payload(payload)


def fetch_launcher_status_through_hub(record: HubRecord) -> dict[str, Any]:
    return fetch_hub_json(record, "/v1/launcher/status")


def unavailable_launcher_status() -> dict[str, Any]:
    return {
        "resource_type": "robotick_launcher_status",
        "service": {
            "state": "hub_unavailable",
            "endpoint": None,
            "pid": None,
        },
        "runtime": None,
    }


def format_launcher_status_payload(payload: dict[str, Any]) -> dict[str, Any]:
    capability_status = str(payload.get("capability_status") or "unknown")
    service_state = "running" if capability_status == "healthy" else capability_status
    return {
        "resource_type": "robotick_launcher_status",
        "service": {
            "state": service_state,
            "endpoint": payload.get("endpoint"),
            "pid": payload.get("pid"),
        },
        "runtime": payload.get("listener_status"),
    }
