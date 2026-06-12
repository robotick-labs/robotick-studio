from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import time
from typing import Literal
from urllib.parse import quote, urlencode

from robotick_cli.app.context import AppContext
from robotick_cli.app.errors import CliError, HubRequestError
from robotick_cli.command_result import CommandResult
from robotick_cli.hub import get_hub_workspace_projects
from robotick_cli.hub_client import (
    discover_hub,
    ensure_hub,
    fetch_hub_json,
    is_hub_healthy,
    is_pid_alive,
    post_hub_json,
    restart_hub,
)
from robotick_cli.instances import (
    InstanceRecord,
    get_live_instance,
    normalize_instance_specifier,
    quit_studio_instance,
)
from robotick_cli.language.help import (
    create_help_text,
    instance_help_text,
    instance_quit_help_text,
    instance_select_project_help_text,
    instances_help_text,
    open_help_text,
    projects_help_text,
)
from robotick_cli.manifest import Manifest, load_manifest
from robotick_cli.output import write_json, writeln
from robotick_cli.studio_tree import fetch_studio_node_status, list_child_contexts

@dataclass
class OpenLaunchTarget:
    kind: Literal["empty", "project"]
    label: str
    attach: bool
    chain_args: tuple[str, ...] = ()


def run_studio_command(ctx: AppContext, args: list[str]) -> CommandResult:
    if not args or is_help_flag(args[0]):
        writeln(get_studio_help())
        return CommandResult(exit_code=0)

    manifest = load_manifest(ctx.workspace_root)
    command, *rest = args
    if command == "status":
        raise CliError(
            "No Studio instance is currently bound. Use 'robotick studio open [project]' "
            "or 'robotick studio instances' first.",
            code="studio_instance_not_bound",
            recovery="Run `robotick studio open [project]` or `robotick studio instances` first.",
        )
    if command == "quit":
        raise CliError(
            "No Studio instance is currently bound. Use 'robotick studio <instance> quit' "
            "from the instance context.",
            code="studio_instance_not_bound",
            recovery="Run `robotick studio instances` to discover an instance first.",
        )
    if command == "projects":
        handle_projects_command(ctx, rest)
        return CommandResult(exit_code=0)
    if command == "instances":
        handle_instances_command(ctx.workspace_root, rest)
        return CommandResult(exit_code=0)
    if command == "launcher-status":
        handle_launcher_status_command(ctx, rest)
        return CommandResult(exit_code=0)
    if command == "create":
        return handle_create_command(ctx, manifest, rest)
    if command == "open":
        return handle_open_command(ctx, manifest, rest)
    return run_studio_instance_command(ctx, command, rest)


def get_studio_help() -> str:
    from robotick_cli.language.help import get_studio_help_text

    return get_studio_help_text()


def is_help_flag(value: str) -> bool:
    return value in {"--help", "-h", "help"}


def handle_projects_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(projects_help_text())
        return
    unknown_args = [arg for arg in args if arg != "--json"]
    if unknown_args:
        raise CliError(f"Unknown argument for 'projects': {unknown_args[0]}")

    projects = get_hub_workspace_projects(ctx)
    write_json({"projects": projects})


def handle_instances_command(workspace_root: str | Path, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(instances_help_text())
        return
    unknown_args = [arg for arg in args if arg != "--json"]
    if unknown_args:
        raise CliError(f"Unknown argument for 'instances': {unknown_args[0]}")

    payload = fetch_studio_hub_json(workspace_root, "/v1/studio/instances")
    write_json(payload)


def handle_launcher_status_command(ctx: AppContext, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(
            "Usage:\n"
            "  robotick studio launcher-status [project]\n\n"
            "Compares raw hub launcher runtime authority with the Studio-facing launcher projection.\n"
        )
        return
    positionals = [arg for arg in args if arg != "--json"]
    if len(positionals) > 1:
        raise CliError(f"Unknown argument for 'launcher-status': {positionals[1]}")
    project_name = positionals[0] if positionals else None

    from robotick_cli import launcher as launcher_cli

    record = ensure_hub(ctx.workspace_root)
    runtime_path = "/v1/launcher/runtime"
    if project_name:
        runtime_path = f"{runtime_path}?{urlencode({'project_id': project_name})}"
    hub_runtime = fetch_hub_json(record, runtime_path)
    status_payload = fetch_hub_json(record, "/v1/launcher/status")
    if project_name:
        status_payload = launcher_cli.filter_status_payload(
            status_payload,
            {
                "group_id": None,
                "project_id": project_name,
                "session_ids": [],
                "model_ids": [],
            },
        )
    studio_projection = launcher_cli.format_launcher_status_payload(status_payload)
    raw_state = str(hub_runtime.get("state") or hub_runtime.get("status") or "")
    projected_state = str((studio_projection.get("service") or {}).get("state") or "")
    write_json(
        {
            "resource_type": "robotick_studio_launcher_status",
            "project_name": project_name,
            "hub_runtime": hub_runtime,
            "studio_projection": {
                "service": studio_projection.get("service"),
                "runtime": studio_projection.get("runtime"),
            },
            "comparison": {
                "state_agrees": raw_state == projected_state,
                "hub_state": raw_state,
                "studio_state": projected_state,
            },
        }
    )


def handle_instance_quit(ctx: AppContext, instance_name: str, args: list[str]) -> CommandResult:
    if any(is_help_flag(arg) for arg in args):
        writeln(instance_quit_help_text(instance_name))
        return CommandResult(exit_code=0)
    if args:
        raise CliError(f"Unknown argument for '{instance_name} quit': {args[0]}")
    try:
        payload = post_studio_hub_json(
            ctx.workspace_root,
            f"/v1/studio/instances/{instance_name}/quit",
        )
        writeln(payload["message"])
        return CommandResult(exit_code=0 if payload["accepted"] else 1)
    except HubRequestError:
        accepted, message = quit_studio_instance(ctx.workspace_root, instance_name)
        writeln(f"{message} (hub fallback)")
        return CommandResult(exit_code=0 if accepted else 1)


def print_studio_context_listing(
    ctx: AppContext,
    instance_name: str,
    path_segments: tuple[str, ...],
) -> None:
    node = fetch_studio_node_status(ctx.workspace_root, instance_name, path_segments)
    contexts = list_child_contexts(node)
    label = f"studio/{instance_name}"
    if path_segments:
        label += "/" + "/".join(path_segments)
    writeln(f"Available in {label}:")
    writeln("Contexts:")
    if not contexts:
        writeln("- none")
    else:
        for context_name in contexts:
            writeln(f"- {context_name}")


def handle_instance_status(
    ctx: AppContext,
    instance_name: str,
    path_segments: tuple[str, ...],
    args: list[str],
) -> CommandResult:
    if args:
        raise CliError(f"Unknown argument for '{instance_name} status': {args[0]}")
    write_json(fetch_studio_node_status(ctx.workspace_root, instance_name, path_segments))
    return CommandResult(exit_code=0)


def quote_studio_resource_path(path_segments: tuple[str, ...]) -> str:
    return "/".join(quote(segment, safe="") for segment in path_segments)


def resolve_registered_project_path(ctx: AppContext, project_name: str) -> str:
    projects = get_hub_workspace_projects(ctx)
    for project in projects:
        if project.get("name") != project_name:
            continue
        project_path = project.get("project_path")
        if not project_path:
            raise CliError(
                f"Registered project has no project file: {project_name}",
                code="project_file_missing",
                recovery="Create the project file or choose another project from `robotick studio projects`.",
        )
        return str(project_path)
    names = ", ".join(sorted(str(project.get("name")) for project in projects))
    raise CliError(
        f"Unknown project: {project_name}. Registered projects: {names}",
        code="unknown_project",
        recovery="Run `robotick studio projects` to inspect registered projects.",
    )


def handle_instance_select_project(
    ctx: AppContext,
    instance: InstanceRecord,
    args: list[str],
) -> CommandResult:
    if any(is_help_flag(arg) for arg in args):
        writeln(instance_select_project_help_text(instance.name))
        return CommandResult(exit_code=0)
    if len(args) != 1:
        raise CliError(
            f"Usage: robotick studio {instance.name} select-project <project>",
            code="invalid_arguments",
        )
    if not instance.control_endpoint:
        raise CliError(
            f"Studio instance {instance.name} does not expose the Studio control service.",
            code="studio_control_unavailable",
            recovery=(
                "This instance was likely opened before the control service was added. "
                f"Run `robotick studio {instance.name} quit`, then `robotick studio open [project]`."
            ),
        )
    project_path = resolve_registered_project_path(ctx, args[0])
    payload = post_studio_hub_json(
        ctx.workspace_root,
        f"/v1/studio/instances/{instance.name}/project/select",
        {"project_path": project_path},
    )
    write_json(payload)
    return CommandResult(exit_code=0 if payload.get("accepted") is True else 1)


def handle_instance_activate(
    ctx: AppContext,
    instance: InstanceRecord,
    path_segments: tuple[str, ...],
    args: list[str],
) -> CommandResult:
    if args:
        raise CliError(f"Unknown argument for '{instance.name} activate': {args[0]}")
    if not instance.control_endpoint:
        raise CliError(
            f"Studio instance {instance.name} does not expose the Studio control service.",
            code="studio_control_unavailable",
            recovery=(
                "This instance was likely opened before the control service was added. "
                f"Run `robotick studio {instance.name} quit`, then `robotick studio open [project]`."
            ),
        )
    try:
        payload = activate_studio_resource_with_settle(ctx, instance.name, path_segments)
    except HubRequestError as error:
        if error.status_code == 404:
            raise CliError(
                f"Studio instance {instance.name} does not expose Studio resource activation.",
                code="studio_activation_unavailable",
                recovery=(
                    "This instance was likely opened before activation was added. "
                    f"Run `robotick studio {instance.name} quit`, then `robotick studio open [project]`."
                ),
            ) from error
        raise
    write_json(payload)
    return CommandResult(exit_code=0 if payload.get("accepted") is True else 1)


def parse_instance_path_args(
    args: list[str],
) -> tuple[tuple[str, ...], str | None]:
    if not args:
        return (), None
    if any(is_help_flag(arg) for arg in args):
        return (), "help"
    if args == ["quit"]:
        return (), "quit"
    if args and args[0] == "select-project":
        return (), "select-project"
    if args == ["activate"]:
        return (), "activate"
    if args and args[-1] == "activate":
        return tuple(args[:-1]), "activate"
    if args and args[-1] == "status":
        return tuple(args[:-1]), "status"
    return tuple(args), None


def run_studio_instance_command(
    ctx: AppContext,
    instance_token: str,
    args: list[str],
) -> CommandResult:
    instance_name = normalize_instance_specifier(instance_token)
    instance = get_live_instance(ctx.workspace_root, instance_name)
    if instance is None:
        raise CliError(f"Unknown studio command or instance: {instance_token}")
    path_segments, action = parse_instance_path_args(args)
    if action == "help":
        writeln(instance_help_text(instance.name))
        return CommandResult(exit_code=0)
    if action == "quit":
        return handle_instance_quit(ctx, instance.name, [])
    if action == "select-project":
        return handle_instance_select_project(ctx, instance, args[1:])
    if action == "activate":
        return handle_instance_activate(ctx, instance, path_segments, [])
    if action == "status":
        return handle_instance_status(ctx, instance.name, path_segments, [])
    if not args:
        writeln(instance_help_text(instance.name))
        return CommandResult(exit_code=0)
    print_studio_context_listing(ctx, instance.name, path_segments)
    return CommandResult(exit_code=0)


def handle_create_command(ctx: AppContext, manifest: Manifest, args: list[str]) -> CommandResult:
    if any(is_help_flag(arg) for arg in args):
        writeln(create_help_text())
        return CommandResult(exit_code=0)
    target = resolve_open_launch_target(ctx.workspace_root, manifest, args, "create")
    if target.attach:
        raise CliError("--attach is not yet supported on the hub-managed Studio path.")
    return launch_studio_via_hub(ctx, manifest, target)


def handle_open_command(ctx: AppContext, manifest: Manifest, args: list[str]) -> CommandResult:
    if any(is_help_flag(arg) for arg in args):
        writeln(open_help_text())
        return CommandResult(exit_code=0)
    target = resolve_open_launch_target(ctx.workspace_root, manifest, args, "open")
    if target.attach:
        raise CliError("--attach is not yet supported on the hub-managed Studio path.")
    return launch_studio_via_hub(ctx, manifest, target, json_output=True)


def resolve_open_launch_target(
    workspace_root: str | Path,
    manifest: Manifest,
    args: list[str],
    command_name: str = "open",
) -> OpenLaunchTarget:
    attach = False
    project_name: str | None = None
    chain_args: tuple[str, ...] = ()
    index = 0

    while index < len(args):
        arg = args[index]
        if arg == "--attach":
            attach = True
            index += 1
            continue
        if arg.startswith("--") and arg != "--":
            raise CliError(f"Unknown option for '{command_name}': {arg}")
        if project_name is None:
            project_name = arg
        else:
            if command_name == "open":
                chain_args = tuple(args[index:])
                break
            raise CliError(
                f"Extra arguments are not yet supported on the hub-managed Studio path: {arg}"
            )
        index += 1

    if project_name is None:
        return OpenLaunchTarget(
            kind="empty",
            label="Robotick Studio",
            attach=attach,
        )

    project = manifest.projects.get(project_name)
    if project is None:
        names = ", ".join(sorted(manifest.projects))
        raise CliError(
            f"Unknown project: {project_name}. Registered projects: {names}",
            code="unknown_project",
            recovery="Run `robotick studio projects` to inspect registered projects.",
        )

    return OpenLaunchTarget(
        kind="project",
        label=project_name,
        attach=attach,
        chain_args=chain_args,
    )


def launch_studio_via_hub(
    ctx: AppContext,
    manifest: Manifest,
    target: OpenLaunchTarget,
    *,
    json_output: bool = False,
) -> CommandResult:
    project_name = target.label if target.kind == "project" else None
    hub_action = determine_hub_action(ctx.workspace_root)
    payload = post_studio_hub_json(
        ctx.workspace_root,
        "/v1/studio/open",
        {"project_name": project_name},
    )
    instance = dict(payload["instance"])
    control_service = wait_for_studio_control(ctx, str(instance["name"]))
    control_instance = control_service.get("instance")
    if isinstance(control_instance, dict):
        instance.update(control_instance)
    chained_result = None
    if target.chain_args:
        chained_result = run_chained_open_command(
            ctx,
            str(instance["name"]),
            target.chain_args,
            control_service,
        )
        refreshed_active_path = fetch_active_studio_path(ctx, str(instance["name"]))
        if refreshed_active_path:
            control_service["active_path"] = refreshed_active_path
    if json_output:
        instance_name = str(instance["name"])
        instance_command_prefix = ["robotick", "studio", instance_name]
        active_path = control_service.get("active_path")
        window_command_prefix = instance_command_prefix
        if isinstance(active_path, list) and all(isinstance(segment, str) for segment in active_path):
            window_command_prefix = [*instance_command_prefix, *active_path]
        result_payload = {
            "resource_type": (
                "robotick_studio_open_chained_result"
                if chained_result is not None
                else "robotick_studio_open_result"
            ),
            "project_name": project_name,
            "support": {
                "hub": {"action": hub_action},
                **dict(payload.get("support") or {}),
            },
            "instance": instance,
            "control_service": {
                key: value
                for key, value in control_service.items()
                if key != "instance"
            },
            "control_handles": {
                "instance_command_prefix": instance_command_prefix,
                "window_command_prefix": window_command_prefix,
            },
            "notes": [
                "Use the instance command prefix to control this Studio instance.",
                "Running 'robotick studio open ...' again creates a separate Studio instance.",
            ],
        }
        if chained_result is not None:
            result_payload["chained_command"] = chained_result
        write_json(result_payload)
    else:
        if project_name is not None:
            writeln(f"Opening Robotick Studio for {project_name}...")
        else:
            writeln("Opening Robotick Studio...")
        studio_mode = os.environ.get("ROBOTICK_STUDIO_MODE", manifest.studio.default_mode)
        writeln(f"Starting Studio in {studio_mode} mode...")
        if instance.get("log_path"):
            writeln(f"Logs: {os.path.relpath(str(instance['log_path']), ctx.workspace_root)}")
        if project_name is not None:
            writeln(f"Studio launch started for {project_name}.")
        else:
            writeln("Studio launch started.")
        writeln(f"Instance: {instance['name']}/")
    return CommandResult(exit_code=0, opened_instance_name=str(instance["name"]))


def run_chained_open_command(
    ctx: AppContext,
    instance_name: str,
    args: tuple[str, ...],
    control_service: dict[str, object],
) -> dict[str, object]:
    path_segments, action = parse_instance_path_args(list(args))
    if action not in {"status", "activate"}:
        raise CliError(
            "Chained Studio open requires a final action such as 'status' or 'activate'.",
            code="invalid_chained_open_command",
            recovery=(
                "Use `robotick studio open <project> <path...> status` or "
                "`robotick studio open <project> <path...> activate`."
            ),
        )
    if action == "activate" and control_service.get("state") != "ready":
        raise CliError(
            f"Studio instance {instance_name} did not expose the Studio control service in time.",
            code="studio_control_unavailable",
            recovery=(
                f"Run `robotick studio {instance_name} <path...> activate` after "
                "the control service is registered, or retry the open command."
            ),
        )
    if action == "status":
        result = fetch_studio_node_status(ctx.workspace_root, instance_name, path_segments)
    else:
        result = activate_opened_studio_resource(ctx, instance_name, path_segments)
    return {
        "args": list(args),
        "path": list(path_segments),
        "action": action,
        "result": result,
    }


def open_control_wait_timeout_seconds() -> float:
    configured = os.environ.get("ROBOTICK_STUDIO_OPEN_WAIT_CONTROL_SECONDS")
    if configured is not None:
        try:
            return max(0.0, float(configured))
        except ValueError:
            return 0.0
    if os.environ.get("ROBOTICK_HUB_FORCE_HEADLESS") == "1":
        return 0.0
    return 5.0


def wait_for_studio_control(
    ctx: AppContext,
    instance_name: str,
    timeout_seconds: float | None = None,
) -> dict[str, object]:
    timeout_seconds = open_control_wait_timeout_seconds() if timeout_seconds is None else timeout_seconds
    deadline = time.monotonic() + timeout_seconds
    last_instance: InstanceRecord | None = None
    while True:
        instance = get_live_instance(ctx.workspace_root, instance_name)
        if instance is not None:
            last_instance = instance
            if instance.control_endpoint:
                summary: dict[str, object] = {
                    "state": "ready",
                    "endpoint": instance.control_endpoint,
                    "instance": instance.model_dump(),
                }
                active_path = fetch_active_studio_path(ctx, instance.name)
                if active_path:
                    summary["active_path"] = active_path
                return summary
        if time.monotonic() >= deadline:
            if timeout_seconds <= 0:
                state = "not_waited"
            elif last_instance is None:
                state = "unavailable"
            else:
                state = "registering"
            summary = {
                "state": state,
                "endpoint": last_instance.control_endpoint if last_instance else None,
            }
            if last_instance is not None:
                summary["instance"] = last_instance.model_dump()
            return summary
        time.sleep(0.1)


def fetch_active_studio_path(ctx: AppContext, instance_name: str) -> list[str] | None:
    try:
        instance_status = fetch_studio_node_status(ctx.workspace_root, instance_name, ())
    except Exception:
        return None
    active_window_id = instance_status.get("active_window_id")
    if not isinstance(active_window_id, str) or not active_window_id:
        return None
    active_path = ["windows", active_window_id]
    try:
        window_status = fetch_studio_node_status(
            ctx.workspace_root,
            instance_name,
            ("windows", active_window_id),
        )
    except Exception:
        return active_path
    active_workbench_id = window_status.get("active_workbench_id")
    if isinstance(active_workbench_id, str) and active_workbench_id:
        active_path.extend(["workbenches", active_workbench_id])
    return active_path


def activation_settle_timeout_seconds() -> float:
    configured = os.environ.get("ROBOTICK_STUDIO_ACTIVATE_SETTLE_SECONDS")
    if configured is not None:
        try:
            return max(0.0, float(configured))
        except ValueError:
            return 0.0
    return 0.5 if os.environ.get("ROBOTICK_HUB_FORCE_HEADLESS") == "1" else 2.0


def wait_for_studio_activation_applied(
    ctx: AppContext,
    instance_name: str,
    path_segments: tuple[str, ...],
    timeout_seconds: float | None = None,
) -> bool:
    if not path_segments:
        return True
    timeout_seconds = (
        activation_settle_timeout_seconds()
        if timeout_seconds is None
        else timeout_seconds
    )
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            node = fetch_studio_node_status(ctx.workspace_root, instance_name, path_segments)
        except Exception:
            node = None
        if isinstance(node, dict) and node.get("active") is True:
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.1)


def activate_studio_resource_with_settle(
    ctx: AppContext,
    instance_name: str,
    path_segments: tuple[str, ...],
) -> dict[str, object]:
    resource_path = quote_studio_resource_path(path_segments)
    hub_path = (
        f"/v1/studio/instances/{instance_name}/activate"
        if not resource_path
        else f"/v1/studio/instances/{instance_name}/{resource_path}/activate"
    )
    payload = post_studio_hub_json(ctx.workspace_root, hub_path)
    if (
        path_segments
        and payload.get("accepted") is True
        and not wait_for_studio_activation_applied(ctx, instance_name, path_segments)
    ):
        # Studio can report activation before the renderer applies the branch change.
        payload = post_studio_hub_json(ctx.workspace_root, hub_path)
        wait_for_studio_activation_applied(ctx, instance_name, path_segments)
    return payload


def activate_opened_studio_resource(
    ctx: AppContext,
    instance_name: str,
    path_segments: tuple[str, ...],
) -> dict[str, object]:
    return activate_studio_resource_with_settle(ctx, instance_name, path_segments)


def determine_hub_action(workspace_root: str | Path) -> str:
    record = discover_hub(workspace_root)
    if record is None:
        return "started"
    if not is_pid_alive(record.pid):
        return "restarted"
    return "reused" if is_hub_healthy(record) else "restarted"


def fetch_studio_hub_json(workspace_root: str | Path, path: str) -> dict[str, object]:
    record = ensure_hub(workspace_root)
    try:
        return fetch_hub_json(record, path)
    except HubRequestError as error:
        if error.status_code != 404:
            raise
        refreshed = restart_hub(workspace_root)
        return fetch_hub_json(refreshed, path)


def post_studio_hub_json(
    workspace_root: str | Path,
    path: str,
    payload: dict[str, object] | None = None,
) -> dict[str, object]:
    record = ensure_hub(workspace_root)
    try:
        return post_hub_json(record, path, payload)
    except HubRequestError as error:
        if error.status_code != 404:
            raise
        refreshed = restart_hub(workspace_root)
        return post_hub_json(refreshed, path, payload)
