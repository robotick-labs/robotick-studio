from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Literal

from robotick_cli.app.context import AppContext
from robotick_cli.app.errors import CliError, HubRequestError
from robotick_cli.command_result import CommandResult
from robotick_cli.hub import get_hub_workspace_projects
from robotick_cli.hub_client import ensure_hub, fetch_hub_json, post_hub_json, restart_hub
from robotick_cli.instances import (
    format_instance_age,
    get_live_instance,
    normalize_instance_specifier,
    quit_studio_instance,
)
from robotick_cli.language.help import (
    create_help_text,
    instance_help_text,
    instance_quit_help_text,
    instances_help_text,
    open_help_text,
    projects_help_text,
)
from robotick_cli.manifest import Manifest, load_manifest
from robotick_cli.output import write_json, writeln

@dataclass
class OpenLaunchTarget:
    kind: Literal["empty", "project"]
    label: str
    attach: bool


def run_studio_command(ctx: AppContext, args: list[str]) -> CommandResult:
    if not args or is_help_flag(args[0]):
        writeln(get_studio_help())
        return CommandResult(exit_code=0)

    manifest = load_manifest(ctx.workspace_root)
    command, *rest = args
    if command == "projects":
        handle_projects_command(ctx, rest)
        return CommandResult(exit_code=0)
    if command == "instances":
        handle_instances_command(ctx.workspace_root, rest)
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
    json_mode = "--json" in args
    unknown_args = [arg for arg in args if arg != "--json"]
    if unknown_args:
        raise CliError(f"Unknown argument for 'projects': {unknown_args[0]}")

    projects = get_hub_workspace_projects(ctx)
    if json_mode:
        write_json({"projects": projects})
        return
    writeln("Registered Robotick Studio projects:")
    for project in projects:
        writeln(f"- {project['name']}: {project['project_dir']}")


def handle_instances_command(workspace_root: str | Path, args: list[str]) -> None:
    if any(is_help_flag(arg) for arg in args):
        writeln(instances_help_text())
        return
    json_mode = "--json" in args
    unknown_args = [arg for arg in args if arg != "--json"]
    if unknown_args:
        raise CliError(f"Unknown argument for 'instances': {unknown_args[0]}")

    payload = fetch_studio_hub_json(workspace_root, "/v1/studio/instances")
    instances = payload["instances"]
    if json_mode:
        write_json({"instances": instances})
        return

    writeln("Open Robotick Studio instances:")
    if not instances:
        writeln("- none")
        return
    for instance in instances:
        details = [instance["state"], instance["mode"]]
        if instance.get("project_name"):
            details.append(str(instance["project_name"]))
        age = format_instance_age(str(instance["started_at"]))
        if age:
            details.append(age)
        writeln(f"- {instance['name']} ({' | '.join(details)})")


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


def run_studio_instance_command(
    ctx: AppContext,
    instance_token: str,
    args: list[str],
) -> CommandResult:
    instance_name = normalize_instance_specifier(instance_token)
    instance = get_live_instance(ctx.workspace_root, instance_name)
    if instance is None:
        raise CliError(f"Unknown studio command or instance: {instance_token}")
    if not args or is_help_flag(args[0]):
        writeln(instance_help_text(instance.name))
        return CommandResult(exit_code=0)
    command, *rest = args
    if command == "quit":
        return handle_instance_quit(ctx, instance.name, rest)
    raise CliError(f"Unknown instance command for {instance.name}: {command}")


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
    return handle_create_command(ctx, manifest, args)


def resolve_open_launch_target(
    workspace_root: str | Path,
    manifest: Manifest,
    args: list[str],
    command_name: str = "open",
) -> OpenLaunchTarget:
    attach = False
    project_name: str | None = None

    for arg in args:
        if arg == "--attach":
            attach = True
            continue
        if arg.startswith("--") and arg != "--":
            raise CliError(f"Unknown option for '{command_name}': {arg}")
        if project_name is None:
            project_name = arg
        else:
            raise CliError(
                f"Extra arguments are not yet supported on the hub-managed Studio path: {arg}"
            )

    if project_name is None:
        return OpenLaunchTarget(
            kind="empty",
            label="Robotick Studio",
            attach=attach,
        )

    project = manifest.projects.get(project_name)
    if project is None:
        names = ", ".join(sorted(manifest.projects))
        raise CliError(f"Unknown project: {project_name}. Registered projects: {names}")

    return OpenLaunchTarget(
        kind="project",
        label=project_name,
        attach=attach,
    )


def launch_studio_via_hub(
    ctx: AppContext,
    manifest: Manifest,
    target: OpenLaunchTarget,
) -> CommandResult:
    project_name = target.label if target.kind == "project" else None
    payload = post_studio_hub_json(
        ctx.workspace_root,
        "/v1/studio/open",
        {"project_name": project_name},
    )
    instance = payload["instance"]
    if project_name is not None:
        writeln(f"Opening Robotick Studio for {project_name}...")
    else:
        writeln("Opening Robotick Studio...")
    writeln(f"Starting Studio in {manifest.studio.default_mode} mode...")
    if instance.get("log_path"):
        writeln(f"Logs: {os.path.relpath(str(instance['log_path']), ctx.workspace_root)}")
    if project_name is not None:
        writeln(f"Studio launch started for {project_name}.")
    else:
        writeln("Studio launch started.")
    writeln(f"Instance: {instance['name']}/")
    return CommandResult(exit_code=0, opened_instance_name=str(instance["name"]))


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
