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
        value_flags={"--group", "--session", "--project", "--model", "--models"},
        repeatable_flags={"--session", "--model"},
        boolean_flags={"--json"},
    )
    ensure_no_positionals(parsed, "launcher status")
    selection = build_selection_options(parsed)

    record = discover_hub(ctx.workspace_root)
    if record is None or not is_pid_alive(record.pid):
        write_json(unavailable_launcher_status())
        return
    try:
        payload = fetch_launcher_status_through_hub(record)
    except HubRequestError:
        write_json(unavailable_launcher_status())
        return
    if selection["group_id"] or selection["session_ids"] or selection["project_id"] or selection["model_ids"]:
        payload = filter_status_payload(payload, selection)
    write_json(format_launcher_status_payload(payload))


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
            "  robotick launcher logs [--group <id> | --session <id>] [--model <id>]\n"
        )
        return
    parsed = parse_launcher_args(
        args,
        value_flags={"--group", "--session", "--project", "--model", "--models", "--tail"},
        repeatable_flags={"--session", "--model"},
        boolean_flags={"--json"},
    )
    ensure_no_positionals(parsed, "launcher logs")
    selection = build_selection_options(parsed)
    record = ensure_hub(ctx.workspace_root)
    payload = fetch_launcher_status_through_hub(record)

    session_ids = selection["session_ids"]
    model_ids = selection["model_ids"]
    tail = single_flag_value(parsed, "--tail")
    if len(session_ids) == 1 and not selection["group_id"] and not selection["project_id"] and not model_ids:
        write_json(fetch_hub_json(record, f"/v1/launcher/sessions/{session_ids[0]}/logs"))
        return

    if selection["project_id"] and not selection["group_id"] and not session_ids:
        query_params = {"project_id": selection["project_id"]}
        if model_ids:
            query_params["model_ids"] = ",".join(model_ids)
        if tail:
            query_params["tail"] = tail
        path = f"/v1/launcher/models/logs?{urlencode(query_params)}"
        write_json(fetch_hub_json(record, path))
        return

    group = resolve_group_selection(payload, selection, command_name="launcher logs")
    query_params: dict[str, str] = {}
    if model_ids:
        query_params["model_ids"] = ",".join(model_ids)
    if session_ids:
        query_params["session_ids"] = ",".join(session_ids)
    path = f"/v1/launcher/groups/{group['id']}/logs"
    if query_params:
        path = f"{path}?{urlencode(query_params)}"
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
        value_flags={"--group", "--session", "--project", "--model", "--models"},
        repeatable_flags={"--session", "--model"},
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
        value_flags={"--group", "--session", "--project", "--model", "--models"},
        repeatable_flags={"--session", "--model"},
        boolean_flags={"--json"},
    )
    ensure_no_positionals(parsed, "launcher restart")
    payload = run_model_action(ctx, parsed, action="restart")
    write_json({"resource_type": "robotick_launcher_restart_result", **payload})


def handle_wait_ready_command(ctx: AppContext, args: list[str]) -> CommandResult:
    if any(is_help_flag(arg) for arg in args):
        writeln(
            "Usage:\n"
            "  robotick launcher wait-ready [--group <id> | --project <project> | --session <id>] [--model <id>] [--timeout-seconds <n>] [--poll-ms <n>]\n"
        )
        return CommandResult(exit_code=0)
    parsed = parse_launcher_args(
        args,
        value_flags={
            "--group",
            "--session",
            "--project",
            "--model",
            "--models",
            "--timeout-seconds",
            "--poll-ms",
        },
        repeatable_flags={"--session", "--model"},
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
    status_payload = fetch_launcher_status_through_hub(record)
    wait_target = resolve_wait_target(status_payload, selection)
    deadline = time.time() + timeout_seconds
    last_payload: dict[str, Any] | None = None
    while time.time() <= deadline:
        last_payload = fetch_hub_json(record, wait_target["path"])
        readiness = str(last_payload.get("readiness") or "pending")
        if readiness == "ready":
            write_json(
                {
                    "resource_type": "robotick_launcher_wait_ready_result",
                    "status": "ready",
                    "target": last_payload,
                }
            )
            return CommandResult(exit_code=0)
        if readiness in {"failed", "stale"}:
            write_json(
                {
                    "resource_type": "robotick_launcher_wait_ready_result",
                    "status": readiness,
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
            "selection": wait_target["selection"],
        }
    )
    return CommandResult(exit_code=1)


def run_group_action(ctx: AppContext, parsed: dict[str, Any], *, action: str) -> dict[str, Any]:
    selection = build_selection_options(parsed)
    record = ensure_hub(ctx.workspace_root)
    payload = fetch_launcher_status_through_hub(record)
    group = resolve_group_selection(payload, selection, command_name=f"launcher {action}")
    request_payload = {
        "model_ids": selection["model_ids"],
        "session_ids": selection["session_ids"],
    }
    return post_hub_json(
        record,
        f"/v1/launcher/groups/{group['id']}/{action}",
        request_payload,
        timeout_seconds=120,
    )


def run_model_action(ctx: AppContext, parsed: dict[str, Any], *, action: str) -> dict[str, Any]:
    selection = build_selection_options(parsed)
    if selection["group_id"] or selection["session_ids"]:
        raise CliError(f"launcher {action} now targets projects/models; use --project and --model/--models.")
    project_id = selection["project_id"]
    if not project_id:
        payload = fetch_launcher_status_through_hub(ensure_hub(ctx.workspace_root))
        runtime_models = runtime_model_payloads(payload)
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
        "group_id": single_flag_value(parsed, "--group"),
        "project_id": single_flag_value(parsed, "--project"),
        "session_ids": collect_repeated_values(parsed, "--session"),
        "model_ids": collect_repeated_values(parsed, "--model")
        + split_csv_values(single_flag_value(parsed, "--models")),
    }


def group_payloads(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [group for group in payload.get("groups") or [] if isinstance(group, dict)]


def session_payloads(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [session for session in payload.get("sessions") or [] if isinstance(session, dict)]


def runtime_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
    runtime = payload.get("runtime")
    return dict(runtime) if isinstance(runtime, dict) else None


def runtime_model_payloads(payload: dict[str, Any]) -> list[dict[str, Any]]:
    runtime = runtime_payload(payload) or {}
    return [model for model in runtime.get("models") or [] if isinstance(model, dict)]


def filter_status_payload(payload: dict[str, Any], selection: dict[str, Any]) -> dict[str, Any]:
    groups = group_payloads(payload)
    sessions = session_payloads(payload)
    runtime = runtime_payload(payload)
    runtime_models = runtime_model_payloads(payload)

    requested_group_id = selection["group_id"]
    requested_project_id = selection["project_id"]
    requested_session_ids = set(selection["session_ids"])
    requested_model_ids = set(selection["model_ids"])

    if requested_group_id and not any(group.get("id") == requested_group_id for group in groups):
        raise CliError(f"Unknown launcher group: {requested_group_id}")
    if requested_session_ids:
        found_session_ids = {str(session.get("id")) for session in sessions}
        missing_session_ids = sorted(requested_session_ids - found_session_ids)
        if missing_session_ids:
            raise CliError(f"Unknown launcher session: {missing_session_ids[0]}")

    filtered_groups = groups
    filtered_sessions = sessions
    if requested_project_id:
        filtered_groups = [group for group in filtered_groups if group.get("project_id") == requested_project_id]
        filtered_sessions = [session for session in filtered_sessions if session.get("project_id") == requested_project_id]
        runtime_models = [model for model in runtime_models if model.get("project_id") == requested_project_id]
        if not filtered_groups and not filtered_sessions and not runtime_models:
            raise CliError(f"No launcher runtime found for project: {requested_project_id}")
    if requested_group_id:
        filtered_groups = [group for group in filtered_groups if group.get("id") == requested_group_id]
        filtered_sessions = [session for session in filtered_sessions if session.get("group_id") == requested_group_id]
    if requested_session_ids:
        filtered_sessions = [session for session in filtered_sessions if session.get("id") in requested_session_ids]
        session_group_ids = {str(session.get("group_id")) for session in filtered_sessions}
        filtered_groups = [group for group in filtered_groups if group.get("id") in session_group_ids]
    if requested_model_ids:
        filtered_sessions = [session for session in filtered_sessions if session.get("model_id") in requested_model_ids]
        runtime_models = [model for model in runtime_models if model.get("model_id") in requested_model_ids]
        session_group_ids = {str(session.get("group_id")) for session in filtered_sessions}
        filtered_groups = [group for group in filtered_groups if group.get("id") in session_group_ids]
        if not filtered_sessions and not runtime_models:
            raise CliError(f"No launcher runtime matched the requested model selection: {sorted(requested_model_ids)[0]}")

    filtered_runtime = None
    if runtime is not None:
        filtered_runtime = {
            **runtime,
            "models": runtime_models,
        }

    return {
        "resource_type": "robotick_launcher_status",
        "ability": payload.get("ability"),
        "runtime": filtered_runtime,
        "groups": filtered_groups,
        "sessions": filtered_sessions,
    }


def resolve_group_selection(
    payload: dict[str, Any],
    selection: dict[str, Any],
    *,
    command_name: str,
) -> dict[str, Any]:
    groups = group_payloads(payload)
    sessions = session_payloads(payload)
    group_id = selection["group_id"]
    project_id = selection["project_id"]
    session_ids = selection["session_ids"]

    if group_id is not None:
        for group in groups:
            if group.get("id") == group_id:
                return group
        raise CliError(f"Unknown launcher group for '{command_name}': {group_id}")

    if session_ids:
        selected_sessions = [session for session in sessions if session.get("id") in set(session_ids)]
        if len(selected_sessions) != len(set(session_ids)):
            known_ids = {str(session.get('id')) for session in sessions}
            missing = next(session_id for session_id in session_ids if session_id not in known_ids)
            raise CliError(f"Unknown launcher session for '{command_name}': {missing}")
        group_ids = {str(session.get("group_id")) for session in selected_sessions}
        if len(group_ids) != 1:
            raise CliError(f"Launcher session selection for '{command_name}' spans multiple groups; choose one group explicitly.")
        target_group_id = next(iter(group_ids))
        for group in groups:
            if group.get("id") == target_group_id:
                return group
        raise CliError(f"Unknown launcher group for '{command_name}': {target_group_id}")

    if project_id is not None:
        project_groups = [group for group in groups if group.get("project_id") == project_id]
        if not project_groups:
            raise CliError(f"No launcher groups found for project '{project_id}'.")
        if len(project_groups) > 1:
            raise CliError(f"Multiple launcher groups found for project '{project_id}'. Use --group to disambiguate.")
        return project_groups[0]

    if len(groups) == 1:
        return groups[0]
    if not groups:
        raise CliError(f"No launcher groups are available for '{command_name}'.")
    raise CliError(f"Launcher selection for '{command_name}' is ambiguous. Use --group, --project, or --session.")


def resolve_wait_target(payload: dict[str, Any], selection: dict[str, Any]) -> dict[str, Any]:
    session_ids = selection["session_ids"]
    model_ids = selection["model_ids"]
    if len(session_ids) == 1 and not selection["group_id"] and not selection["project_id"] and not model_ids:
        return {
            "path": f"/v1/launcher/sessions/{session_ids[0]}",
            "selection": {"session_id": session_ids[0]},
        }

    group = resolve_group_selection(payload, selection, command_name="launcher wait-ready")
    if len(model_ids) == 1:
        matching_sessions = [
            session
            for session in session_payloads(payload)
            if session.get("group_id") == group.get("id") and session.get("model_id") == model_ids[0]
        ]
        if matching_sessions:
            latest = max(matching_sessions, key=lambda session: int(session.get("generation") or 0))
            return {
                "path": f"/v1/launcher/sessions/{latest['id']}",
                "selection": {"group_id": group["id"], "model_id": model_ids[0], "session_id": latest["id"]},
            }
    return {
        "path": f"/v1/launcher/groups/{group['id']}",
        "selection": {"group_id": group["id"]},
    }


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
    if payload.get("resource_type") == "robotick_launcher_status":
        groups = payload.get("groups") or []
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
                "groups": groups,
                "sessions": payload.get("sessions") or [],
            }

        group_statuses = [
            str(group.get("status") or "")
            for group in groups
            if isinstance(group, dict)
        ]
        if not group_statuses:
            state = "stopped"
        elif any(status == "running" for status in group_statuses):
            state = "running"
        elif any(status == "starting" for status in group_statuses):
            state = "starting"
        elif any(status == "degraded" for status in group_statuses):
            state = "degraded"
        elif any(status == "failed" for status in group_statuses):
            state = "failed"
        elif any(status == "stale" for status in group_statuses):
            state = "stale"
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
            "groups": groups,
            "sessions": payload.get("sessions") or [],
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
