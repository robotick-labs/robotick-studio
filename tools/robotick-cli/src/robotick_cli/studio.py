from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import os
from pathlib import Path
import socket
import subprocess
from typing import Literal

from robotick_cli.app.context import AppContext
from robotick_cli.app.errors import CliError
from robotick_cli.command_result import CommandResult
from robotick_cli.hub import get_hub_workspace_projects
from robotick_cli.instances import (
    InstanceRecord,
    create_instance_name,
    get_live_instance,
    list_live_instances,
    normalize_instance_specifier,
    quit_studio_instance,
    write_instance_record,
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
    launch_script: str
    attach: bool
    forwarded_args: list[str]


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

    instances = list_live_instances(workspace_root)
    if json_mode:
        write_json({"instances": [instance.model_dump(mode="json") for instance in instances]})
        return

    writeln("Open Robotick Studio instances:")
    if not instances:
        writeln("- none")
        return
    for instance in instances:
        project_suffix = f" ({instance.project_name})" if instance.project_name else ""
        writeln(f"- {instance.name}{project_suffix}")


def handle_instance_quit(ctx: AppContext, instance_name: str, args: list[str]) -> CommandResult:
    if any(is_help_flag(arg) for arg in args):
        writeln(instance_quit_help_text(instance_name))
        return CommandResult(exit_code=0)
    if args:
        raise CliError(f"Unknown argument for '{instance_name} quit': {args[0]}")
    accepted, message = quit_studio_instance(ctx.workspace_root, instance_name)
    writeln(message)
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
    return launch_studio_target(ctx.workspace_root, manifest, target)


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
    forwarded_args: list[str] = []
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
            forwarded_args.append(arg)

    if project_name is None:
        return OpenLaunchTarget(
            kind="empty",
            label="Robotick Studio",
            launch_script=resolve_studio_runner_path(workspace_root, manifest),
            attach=attach,
            forwarded_args=forwarded_args,
        )

    project = manifest.projects.get(project_name)
    if project is None:
        names = ", ".join(sorted(manifest.projects))
        raise CliError(f"Unknown project: {project_name}. Registered projects: {names}")

    launch_script = str((Path(workspace_root) / project.launch_script).resolve())
    if not Path(launch_script).exists():
        raise CliError(f"Launch script not found: {launch_script}")

    return OpenLaunchTarget(
        kind="project",
        label=project_name,
        launch_script=launch_script,
        attach=attach,
        forwarded_args=forwarded_args,
    )


def launch_studio_target(
    workspace_root: str | Path,
    manifest: Manifest,
    target: OpenLaunchTarget,
) -> CommandResult:
    env = create_studio_launch_env(workspace_root, manifest)
    if not target.attach:
        return launch_quiet_studio(
            workspace_root,
            target.label,
            manifest,
            target.launch_script,
            target.forwarded_args,
            env,
            has_project=target.kind == "project",
        )
    return launch_attached_studio(
        workspace_root,
        target.label,
        target.launch_script,
        target.forwarded_args,
        env,
        has_project=target.kind == "project",
    )


def create_studio_log_path(workspace_root: str | Path, project_name: str) -> Path:
    logs_dir = Path(workspace_root) / ".robotick" / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).isoformat().replace(":", "-")
    return logs_dir / f"studio-open-{project_name}-{timestamp}.log"


def launch_quiet_studio(
    workspace_root: str | Path,
    label: str,
    manifest: Manifest,
    launch_script: str,
    forwarded_args: list[str],
    env: dict[str, str],
    *,
    has_project: bool,
) -> CommandResult:
    log_path = create_studio_log_path(workspace_root, label if has_project else "empty")
    log_handle = open(log_path, "a", encoding="utf-8")
    writeln(f"Opening Robotick Studio for {label}..." if has_project else "Opening Robotick Studio...")
    writeln(f"Starting Studio in {manifest.studio.default_mode} mode...")
    writeln(f"Logs: {os.path.relpath(log_path, workspace_root)}")
    try:
        child = subprocess.Popen(
            [launch_script, *forwarded_args],
            cwd=workspace_root,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )
    finally:
        log_handle.close()

    instance_name = create_instance_name(child.pid)
    if instance_name is not None:
        write_instance_record(
            workspace_root,
            InstanceRecord(
                name=instance_name,
                pid=child.pid,
                mode=manifest.studio.default_mode,
                log_path=str(log_path),
                project_name=label if has_project else None,
                started_at=datetime.now(timezone.utc).isoformat(),
            ),
        )
    writeln(f"Studio launch started for {label}." if has_project else "Studio launch started.")
    if instance_name is not None:
        writeln(f"Instance: {instance_name}/")
    return CommandResult(exit_code=0, opened_instance_name=instance_name)


def launch_attached_studio(
    workspace_root: str | Path,
    label: str,
    launch_script: str,
    forwarded_args: list[str],
    env: dict[str, str],
    *,
    has_project: bool,
) -> CommandResult:
    writeln(f"Opening Robotick Studio for {label}..." if has_project else "Opening Robotick Studio...")
    writeln("Attaching to full Studio logs. Use this mode when you want raw dev/build output.")
    child = subprocess.Popen([launch_script, *forwarded_args], cwd=workspace_root, env=env)
    instance_name = create_instance_name(child.pid)
    if instance_name is not None:
        writeln(f"Instance: {instance_name}/")
    code = child.wait()
    return CommandResult(exit_code=code, opened_instance_name=instance_name)


def create_studio_launch_env(workspace_root: str | Path, manifest: Manifest) -> dict[str, str]:
    remote_debugging_port = os.environ.get("ROBOTICK_REMOTE_DEBUGGING_PORT") or str(
        find_available_port()
    )
    return {
        **os.environ,
        "ROBOTICK_WORKSPACE_ROOT": str(workspace_root),
        "ROBOTICK_STUDIO_MODE": os.environ.get("ROBOTICK_STUDIO_MODE", manifest.studio.default_mode),
        "ROBOTICK_STUDIO_DIR": os.environ.get(
            "ROBOTICK_STUDIO_DIR",
            str((Path(workspace_root) / manifest.studio.default_path).resolve()),
        ),
        "ROBOTICK_REMOTE_DEBUGGING_PORT": remote_debugging_port,
    }


def resolve_studio_runner_path(workspace_root: str | Path, manifest: Manifest) -> str:
    studio_dir = Path(
        os.environ.get(
            "ROBOTICK_STUDIO_DIR",
            str((Path(workspace_root) / manifest.studio.default_path).resolve()),
        )
    )
    mode = os.environ.get("ROBOTICK_STUDIO_MODE", manifest.studio.default_mode)
    runner_name = "run-studio-production.sh" if mode == "production" else "run-studio-dev.sh"
    runner = studio_dir / runner_name
    if not runner.exists():
        raise CliError(f"Expected Studio runner at {runner}")
    return str(runner)


def find_available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        return int(server.getsockname()[1])
