from __future__ import annotations

import os
import time
from typing import Any
from urllib.parse import urlencode

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
    if command == "launch":
        handle_launch_command(ctx, rest)
        return CommandResult(exit_code=0)
    if command == "logs":
        handle_logs_command(ctx, rest)
        return CommandResult(exit_code=0)
    if command == "stop":
        handle_stop_command(ctx, rest)
        return CommandResult(exit_code=0)
    if command == "restart":
        handle_restart_command(ctx, rest)
        return CommandResult(exit_code=0)
    if command == "wait-ready":
        return handle_wait_ready_command(ctx, rest)
    raise CliError(f"Unknown launcher command: {command}")


def handle_status_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(launcher_status_help_text())
        return
    parsed = parse_launcher_args(
        args,
        value_flags={"--project", "--model", "--models"},
        repeatable_flags={"--model"},
        boolean_flags={"--json"},
    )
    ensure_no_positionals(parsed, "launcher status")
    selection = build_selection_options(parsed)

    record = discover_hub(ctx.workspace_root)
    if record is None or not is_pid_alive(record.pid):
        write_json(unavailable_launcher_status())
        return
    try:
        payload = fetch_launcher_runtime_through_hub(
            record,
            project_id=selection["project_id"],
            model_ids=selection["model_ids"],
        )
    except HubRequestError:
        write_json(unavailable_launcher_status())
        return
    write_json(format_launcher_status_payload({"resource_type": "robotick_launcher_status", "runtime": payload}))


def handle_ensure_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln("Usage:\n  robotick launcher ensure\n")
        return
    parsed = parse_launcher_args(args, value_flags=set(), repeatable_flags=set(), boolean_flags={"--json"})
    ensure_no_positionals(parsed, "launcher ensure")

    previous_record = discover_hub(ctx.workspace_root)
    previous_alive = previous_record is not None and is_pid_alive(previous_record.pid)
    record = ensure_hub(ctx.workspace_root)
    payload = fetch_launcher_status_through_hub(record)
    if not previous_alive:
        action = "started"
    elif previous_record is not None and (
        previous_record.pid != record.pid or previous_record.endpoint != record.endpoint
    ):
        action = "restarted"
    else:
        action = "reused"
    formatted_status = format_launcher_status_payload(payload)
    formatted_status["service"]["endpoint"] = record.endpoint
    formatted_status["service"]["pid"] = record.pid
    if formatted_status.get("runtime") is None:
        formatted_status["runtime"] = {"status": "stopped"}
    write_json(
        {
            "resource_type": "robotick_launcher_ensure_result",
            "action": action,
            "status": formatted_status,
        }
    )


def handle_launch_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(
            "Usage:\n"
            "  robotick launcher launch <project> [profile]\n"
            "  robotick launcher launch <project> [--profile <selector>]\n"
            "  robotick launcher launch <project> [--all | --model <id> | --models <id,...>] [--local | --native]\n"
        )
        return
    parsed = parse_launcher_args(
        args,
        value_flags={"--profile", "--model", "--models"},
        repeatable_flags={"--model"},
        boolean_flags={"--json", "--all", "--local", "--native"},
    )
    if not parsed["positionals"]:
        raise CliError("Usage: robotick launcher launch <project> [profile]")
    project_name = parsed["positionals"][0]
    positional_profile = parsed["positionals"][1] if len(parsed["positionals"]) > 1 else None
    if len(parsed["positionals"]) > 2:
        raise CliError(f"Unknown argument for 'launcher launch': {parsed['positionals'][2]}")

    profile_flag = single_flag_value(parsed, "--profile")
    model_ids = collect_repeated_values(parsed, "--model")
    model_ids.extend(split_csv_values(single_flag_value(parsed, "--models")))
    use_all = has_flag(parsed, "--all")
    local = has_flag(parsed, "--local")
    native = has_flag(parsed, "--native")

    if local and native:
        raise CliError("Choose only one target policy flag: --local or --native.")
    if positional_profile and profile_flag:
        raise CliError("Provide the launcher profile either positionally or with --profile, not both.")

    scope_modes = sum(
        1
        for enabled in [
            bool(positional_profile or profile_flag),
            bool(model_ids),
            use_all,
        ]
        if enabled
    )
    if scope_modes > 1:
        raise CliError("Choose only one launch scope source: profile, --all, or --model/--models.")

    record = ensure_hub(ctx.workspace_root)
    creator = {"client": "robotick-cli", "instance_id": f"cli-{os.getpid()}"}
    request_payload: dict[str, Any] = {"project_name": project_name, "creator": creator}
    profile = positional_profile or profile_flag
    if profile:
        if local or native:
            raise CliError("Profile launch already encodes target policy; do not combine it with --local or --native.")
        request_payload["profile"] = profile
    elif model_ids or use_all:
        target_policy = "local" if local else "native"
        if use_all:
            scope = {"kind": "ALL", "value": "ALL"}
        elif len(model_ids) == 1:
            scope = {"kind": "model", "value": model_ids[0]}
        else:
            scope = {"kind": "models", "value": model_ids}
        request_payload["intent"] = {
            "project": project_name,
            "scope": scope,
            "target_policy": target_policy,
        }
    else:
        request_payload["profile"] = "native:ALL"

    payload = post_hub_json(
        record,
        "/v1/launcher/models/launch",
        request_payload,
        timeout_seconds=120,
    )
    write_json({"resource_type": "robotick_launcher_launch_result", **payload})


def handle_logs_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(
            "Usage:\n"
            "  robotick launcher logs --project <project> [--model <id> | --models <id,...>] [--tail <n>]\n"
        )
        return
    parsed = parse_launcher_args(
        args,
        value_flags={"--project", "--model", "--models", "--tail"},
        repeatable_flags={"--model"},
        boolean_flags={"--json"},
    )
    ensure_no_positionals(parsed, "launcher logs")
    selection = build_selection_options(parsed)
    record = ensure_hub(ctx.workspace_root)

    model_ids = selection["model_ids"]
    tail = single_flag_value(parsed, "--tail")
    if not selection["project_id"]:
        raise CliError("launcher logs requires --project.")
    query_params = {"project_id": selection["project_id"]}
    if model_ids:
        query_params["model_ids"] = ",".join(model_ids)
    if tail:
        query_params["tail"] = tail
    path = f"/v1/launcher/models/logs?{urlencode(query_params)}"
    write_json(fetch_hub_json(record, path))


def handle_stop_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(
            "Usage:\n"
            "  robotick launcher stop --project <project> [--model <id> | --models <id,...>]\n"
        )
        return
    parsed = parse_launcher_args(
        args,
        value_flags={"--project", "--model", "--models"},
        repeatable_flags={"--model"},
        boolean_flags={"--json"},
    )
    ensure_no_positionals(parsed, "launcher stop")
    payload = run_model_action(ctx, parsed, action="stop")
    write_json({"resource_type": "robotick_launcher_stop_result", **payload})


def handle_restart_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(
            "Usage:\n"
            "  robotick launcher restart --project <project> [--model <id> | --models <id,...>]\n"
        )
        return
    parsed = parse_launcher_args(
        args,
        value_flags={"--project", "--model", "--models"},
        repeatable_flags={"--model"},
        boolean_flags={"--json"},
    )
    ensure_no_positionals(parsed, "launcher restart")
    payload = run_model_action(ctx, parsed, action="restart")
    write_json({"resource_type": "robotick_launcher_restart_result", **payload})


def handle_wait_ready_command(ctx: AppContext, args: list[str]) -> CommandResult:
    if any(is_help_flag(arg) for arg in args):
        writeln(
            "Usage:\n"
            "  robotick launcher wait-ready --project <project> [--model <id> | --models <id,...>] [--timeout-seconds <n>] [--poll-ms <n>]\n"
        )
        return CommandResult(exit_code=0)
    parsed = parse_launcher_args(
        args,
        value_flags={
            "--project",
            "--model",
            "--models",
            "--timeout-seconds",
            "--poll-ms",
        },
        repeatable_flags={"--model"},
        boolean_flags={"--json"},
    )
    ensure_no_positionals(parsed, "launcher wait-ready")
    timeout_seconds = float(single_flag_value(parsed, "--timeout-seconds") or "30")
    poll_ms = int(single_flag_value(parsed, "--poll-ms") or "500")
    if timeout_seconds <= 0:
        raise CliError("--timeout-seconds must be greater than zero.")
    if poll_ms <= 0:
        raise CliError("--poll-ms must be greater than zero.")

    selection = build_selection_options(parsed)
    record = ensure_hub(ctx.workspace_root)
    if not selection["project_id"]:
        raise CliError("launcher wait-ready requires --project.")
    deadline = time.time() + timeout_seconds
    last_payload: dict[str, Any] | None = None
    while time.time() <= deadline:
        last_payload = fetch_launcher_runtime_through_hub(
            record,
            project_id=selection["project_id"],
            model_ids=selection["model_ids"],
        )
        models = runtime_model_payloads({"runtime": last_payload})
        if not selection["model_ids"]:
            models = [
                model
                for model in models
                if str(model.get("lifecycle") or "") in {"starting", "running", "stopping"}
                or str(model.get("freshness") or "") in {"live", "failed"}
            ]
        readiness_values = {str(model.get("readiness") or "pending") for model in models}
        lifecycle_values = {str(model.get("lifecycle") or "pending") for model in models}
        if models and readiness_values == {"ready"}:
            write_json(
                {
                    "resource_type": "robotick_launcher_wait_ready_result",
                    "status": "ready",
                    "target": last_payload,
                }
            )
            return CommandResult(exit_code=0)
        if "failed" in readiness_values or "failed" in lifecycle_values or "stale" in readiness_values:
            write_json(
                {
                    "resource_type": "robotick_launcher_wait_ready_result",
                    "status": "failed" if "failed" in readiness_values or "failed" in lifecycle_values else "stale",
                    "target": last_payload,
                }
            )
            return CommandResult(exit_code=1)
        time.sleep(poll_ms / 1000)

    write_json(
        {
            "resource_type": "robotick_launcher_wait_ready_result",
            "status": "timeout",
            "target": last_payload,
            "selection": {
                "project_id": selection["project_id"],
                "model_ids": selection["model_ids"],
            },
        }
    )
    return CommandResult(exit_code=1)


def run_model_action(ctx: AppContext, parsed: dict[str, Any], *, action: str) -> dict[str, Any]:
    selection = build_selection_options(parsed)
    project_id = selection["project_id"]
    if not project_id:
        runtime = fetch_launcher_runtime_through_hub(ensure_hub(ctx.workspace_root))
        runtime_models = runtime_model_payloads({"runtime": runtime})
        project_ids = sorted(
            {
                str(model.get("project_id") or "").strip()
                for model in runtime_models
                if str(model.get("project_id") or "").strip()
            }
        )
        if len(project_ids) == 1:
            project_id = project_ids[0]
        else:
            raise CliError(f"launcher {action} requires --project when multiple or no projects have runtime state.")
    record = ensure_hub(ctx.workspace_root)
    request_payload = {
        "project_name": project_id,
        "model_ids": selection["model_ids"],
        "creator": {"client": "robotick-cli", "instance_id": f"cli-{os.getpid()}"},
    }
    if action == "restart":
        if selection["model_ids"]:
            scope = (
                {"kind": "model", "value": selection["model_ids"][0]}
                if len(selection["model_ids"]) == 1
                else {"kind": "models", "value": selection["model_ids"]}
            )
        else:
            scope = {"kind": "ALL", "value": "ALL"}
        request_payload["intent"] = {
            "project": project_id,
            "scope": scope,
            "target_policy": "native",
        }
    return post_hub_json(
        record,
        f"/v1/launcher/models/{action}",
        request_payload,
        timeout_seconds=120,
    )


def parse_launcher_args(
    args: list[str],
    *,
    value_flags: set[str],
    repeatable_flags: set[str],
    boolean_flags: set[str],
) -> dict[str, Any]:
    positionals: list[str] = []
    values: dict[str, list[str]] = {flag: [] for flag in value_flags}
    booleans = {flag: False for flag in boolean_flags}
    index = 0
    while index < len(args):
        token = args[index]
        if token in boolean_flags:
            booleans[token] = True
            index += 1
            continue
        if token in value_flags:
            if index + 1 >= len(args):
                raise CliError(f"Missing value for {token}.")
            values[token].append(args[index + 1])
            index += 2
            continue
        if token.startswith("--"):
            raise CliError(f"Unknown argument: {token}")
        positionals.append(token)
        index += 1

    for flag, collected in values.items():
        if flag not in repeatable_flags and len(collected) > 1:
            raise CliError(f"{flag} may only be provided once.")

    return {"positionals": positionals, "values": values, "booleans": booleans}


def ensure_no_positionals(parsed: dict[str, Any], command_name: str) -> None:
    positionals = parsed["positionals"]
    if positionals:
        raise CliError(f"Unknown argument for '{command_name}': {positionals[0]}")


def has_flag(parsed: dict[str, Any], flag: str) -> bool:
    return bool(parsed["booleans"].get(flag))


def single_flag_value(parsed: dict[str, Any], flag: str) -> str | None:
    values = parsed["values"].get(flag) or []
    if not values:
        return None
    if len(values) > 1:
        raise CliError(f"{flag} may only be provided once.")
    return str(values[0])


def collect_repeated_values(parsed: dict[str, Any], flag: str) -> list[str]:
    values = []
    for raw_value in parsed["values"].get(flag) or []:
        values.extend(split_csv_values(str(raw_value)))
    return values


def split_csv_values(raw_value: str | None) -> list[str]:
    if raw_value is None:
        return []
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def build_selection_options(parsed: dict[str, Any]) -> dict[str, Any]:
    return {
        "project_id": single_flag_value(parsed, "--project"),
        "model_ids": collect_repeated_values(parsed, "--model")
        + split_csv_values(single_flag_value(parsed, "--models")),
    }


def runtime_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
    runtime = payload.get("runtime")
    return dict(runtime) if isinstance(runtime, dict) else None


def runtime_model_payloads(payload: dict[str, Any]) -> list[dict[str, Any]]:
    runtime = runtime_payload(payload) or {}
    return [model for model in runtime.get("models") or [] if isinstance(model, dict)]


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


def fetch_launcher_runtime_through_hub(
    record: HubRecord,
    *,
    project_id: str | None = None,
    model_ids: list[str] | None = None,
) -> dict[str, Any]:
    query_params: dict[str, str] = {}
    if project_id:
        query_params["project_id"] = project_id
    if model_ids:
        query_params["model_ids"] = ",".join(model_ids)
    path = "/v1/launcher/runtime"
    if query_params:
        path = f"{path}?{urlencode(query_params)}"
    return fetch_hub_json(record, path)


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
    if payload.get("resource_type") == "robotick_launcher_status":
        runtime = runtime_payload(payload)
        runtime_models = runtime_model_payloads(payload)
        if runtime is not None:
            if any(str(model.get("lifecycle") or "") == "stopping" for model in runtime_models):
                state = "stopping"
            elif any(str(model.get("lifecycle") or "") == "starting" for model in runtime_models):
                state = "starting"
            elif any(
                str(model.get("lifecycle") or "") == "running"
                or str(model.get("freshness") or "") == "live"
                for model in runtime_models
            ):
                state = "running"
            elif any(str(model.get("freshness") or "") == "failed" for model in runtime_models):
                state = "degraded"
            else:
                state = "stopped"
            return {
                "resource_type": "robotick_launcher_status",
                "service": {
                    "state": state,
                    "endpoint": None,
                    "pid": None,
                },
                "ability": payload.get("ability"),
                "runtime": {**runtime, "status": runtime.get("status") or state},
            }
        return {
            "resource_type": "robotick_launcher_status",
            "service": {
                "state": "stopped",
                "endpoint": None,
                "pid": None,
            },
            "ability": payload.get("ability"),
            "runtime": None,
        }

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
