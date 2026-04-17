from __future__ import annotations

from dataclasses import dataclass, replace
import shlex
from pathlib import Path
from typing import Callable, Optional

from robotick.launcher.actions.launch.docker_linux import (
    load_docker_linux_spec,
    print_docker_linux_summary,
    build_docker_linux,
    deploy_docker_linux,
    stop_docker_linux,
    run_docker_linux,
)
from robotick.launcher.actions.launch.remote_linux import (
    load_remote_linux_spec,
    print_remote_linux_summary,
    build_remote_linux,
    sync_remote_linux_project,
    stop_remote_linux_process,
    run_remote_linux,
)
from robotick.launcher.actions.launch.stages import LaunchStage
from robotick.launcher.config import Config
from robotick.launcher.utils import run_subprocess


LOCAL_STRATEGY = "local"
CONTAINER_STRATEGY = "container"
REMOTE_STRATEGY = "remote"
CUSTOM_STAGE_COMMAND_KEY_BY_STAGE = {
    LaunchStage.BUILD: "build_command",
    LaunchStage.DEPLOY: "deploy_command",
    LaunchStage.RUN: "run_command",
    LaunchStage.STOP: "stop_command",
}
CUSTOM_STAGE_SCRIPT_NAME_BY_STAGE = {
    LaunchStage.BUILD: "do_launcher_build.sh",
    LaunchStage.DEPLOY: "do_launcher_deploy.sh",
    LaunchStage.RUN: "do_launcher_run.sh",
    LaunchStage.STOP: "do_launcher_stop.sh",
}


@dataclass(frozen=True)
class TargetActionPlan:
    strategy: str
    summary_printer: Optional[Callable[[], None]] = None
    build_handler: Optional[Callable[[bool], None]] = None
    deploy_handler: Optional[Callable[[bool], None]] = None
    stop_handler: Optional[Callable[[bool], None]] = None
    run_handler: Optional[Callable[[bool], None]] = None
    local_binary_path: Optional[Path] = None
    display_binary_path: Optional[str] = None
    supports_script_dry_run: bool = False
    shared_deploy_key: Optional[tuple[str, ...]] = None

    def print_summary(self) -> None:
        if self.summary_printer is not None:
            self.summary_printer()


@dataclass(frozen=True)
class TargetPlan:
    project: str
    model: str
    target: str
    target_platform: str
    target_variant: str
    build: TargetActionPlan
    deploy: TargetActionPlan
    run: TargetActionPlan


def _run_generated_stage_script(script_path: Path, dry_run: bool) -> None:
    cmd = ["bash", str(script_path)]
    quoted = " ".join(shlex.quote(part) for part in cmd)
    print(f"$ {quoted}")
    if dry_run:
        return
    if not script_path.exists():
        raise FileNotFoundError(f"Stage script not found: {script_path}")
    run_subprocess(cmd, cwd=script_path.parent)


def _resolve_custom_stage_script_paths(config: Config) -> dict[LaunchStage, Path]:
    runtime = dict(config.model.get("runtime") or {})
    stages_cfg = runtime.get("custom_stages") or {}
    if not isinstance(stages_cfg, dict):
        raise ValueError("Model runtime.custom_stages must be a mapping when provided.")

    script_paths: dict[LaunchStage, Path] = {}
    for stage, stage_key in CUSTOM_STAGE_COMMAND_KEY_BY_STAGE.items():
        script_name = CUSTOM_STAGE_SCRIPT_NAME_BY_STAGE[stage]
        command_value = stages_cfg.get(stage_key)
        if command_value is None:
            continue
        if not isinstance(command_value, str) or not command_value.strip():
            raise ValueError(
                f"Model runtime.custom_stages.{stage_key} must be a non-empty string when provided."
            )
        script_paths[stage] = config.launcher_dir / script_name
    return script_paths


def resolve_target_plan(
    project: str,
    model: str,
    target: str,
    base_dir: Path,
) -> TargetPlan:
    config = Config(project, model, target, base_dir, dry_run=False, stub_install=False)
    runtime = dict(config.model.get("runtime") or {})
    target_platform = str(runtime.get("target_platform") or target).strip().lower()
    target_variant = str(runtime.get("target_variant") or "").strip().lower()

    container_spec = load_docker_linux_spec(project, model, target, base_dir)
    remote_spec = load_remote_linux_spec(project, model, target, base_dir)

    build = TargetActionPlan(strategy=LOCAL_STRATEGY)
    deploy = TargetActionPlan(strategy=LOCAL_STRATEGY)
    run = TargetActionPlan(strategy=LOCAL_STRATEGY)

    if container_spec:
        summary_printer = lambda spec=container_spec: print_docker_linux_summary(spec)
        build = TargetActionPlan(
            strategy=CONTAINER_STRATEGY,
            summary_printer=summary_printer,
            build_handler=lambda dry_run, spec=container_spec: build_docker_linux(
                spec, dry_run=dry_run
            ),
            local_binary_path=container_spec.local_binary_path,
            display_binary_path=str(container_spec.local_binary_path),
        )
        if container_spec.supports_runtime:
            deploy = TargetActionPlan(
                strategy=CONTAINER_STRATEGY,
                summary_printer=summary_printer,
                deploy_handler=lambda dry_run, spec=container_spec: deploy_docker_linux(
                    spec, dry_run=dry_run
                ),
                display_binary_path=str(container_spec.local_binary_path),
            )
            run = TargetActionPlan(
                strategy=CONTAINER_STRATEGY,
                summary_printer=summary_printer,
                stop_handler=lambda dry_run, spec=container_spec: stop_docker_linux(
                    spec, dry_run=dry_run
                ),
                run_handler=lambda dry_run, spec=container_spec: run_docker_linux(
                    spec, dry_run=dry_run
                ),
                display_binary_path=str(container_spec.local_binary_path),
            )
    elif remote_spec:
        # Legacy fallback: if a target is remote but has no local container/cross-build
        # path, fall back to building on the remote host.
        build = TargetActionPlan(
            strategy=REMOTE_STRATEGY,
            summary_printer=lambda spec=remote_spec: print_remote_linux_summary(spec),
            build_handler=lambda dry_run, spec=remote_spec: build_remote_linux(
                spec, dry_run=dry_run
            ),
            display_binary_path=remote_spec.remote_binary_path,
        )

    if remote_spec:
        deploy = TargetActionPlan(
            strategy=REMOTE_STRATEGY,
            summary_printer=lambda spec=remote_spec: print_remote_linux_summary(spec),
            deploy_handler=lambda dry_run, spec=remote_spec: sync_remote_linux_project(
                spec, dry_run=dry_run
            ),
            display_binary_path=remote_spec.remote_binary_path,
            shared_deploy_key=(
                "remote-linux-project-sync",
                remote_spec.ssh_target,
                remote_spec.remote_project_dir,
            ),
        )
        run = TargetActionPlan(
            strategy=REMOTE_STRATEGY,
            summary_printer=lambda spec=remote_spec: print_remote_linux_summary(spec),
            stop_handler=lambda dry_run, spec=remote_spec: stop_remote_linux_process(
                spec, dry_run=dry_run
            ),
            run_handler=lambda dry_run, spec=remote_spec: run_remote_linux(
                spec, dry_run=dry_run
            ),
            display_binary_path=remote_spec.remote_binary_path,
        )

    deploy_cfg = dict(runtime.get("deploy") or {})
    serial_port = str(deploy_cfg.get("serial_port") or "").strip()
    preferred_host = str(runtime.get("preferred_host") or "").strip()
    if target_platform == "esp32":

        def _print_esp32_run_summary() -> None:
            print(f"[cyan]🧭 Target variant:  [/] {target_variant or '(unspecified)'}")
            if serial_port:
                print(f"[cyan]🔌 Serial port:     [/] {serial_port}")
            if preferred_host:
                print(f"[cyan]🌐 Preferred host:  [/] {preferred_host}")

        run = TargetActionPlan(
            strategy=LOCAL_STRATEGY,
            summary_printer=_print_esp32_run_summary,
            supports_script_dry_run=True,
        )

    custom_stage_scripts = _resolve_custom_stage_script_paths(config)
    custom_build_script = custom_stage_scripts.get(LaunchStage.BUILD)
    if custom_build_script is not None:
        build = replace(
            build,
            strategy=LOCAL_STRATEGY,
            build_handler=lambda dry_run, script=custom_build_script: _run_generated_stage_script(
                script, dry_run
            ),
            local_binary_path=None,
            display_binary_path=None,
        )

    custom_deploy_script = custom_stage_scripts.get(LaunchStage.DEPLOY)
    if custom_deploy_script is not None:
        deploy = replace(
            deploy,
            strategy=LOCAL_STRATEGY,
            deploy_handler=lambda dry_run, script=custom_deploy_script: _run_generated_stage_script(
                script, dry_run
            ),
            shared_deploy_key=None,
        )
    elif custom_stage_scripts:
        deploy = replace(
            deploy,
            strategy=LOCAL_STRATEGY,
            deploy_handler=None,
            shared_deploy_key=None,
        )

    custom_run_script = custom_stage_scripts.get(LaunchStage.RUN)
    if custom_run_script is not None:
        run = replace(
            run,
            strategy=LOCAL_STRATEGY,
            run_handler=lambda dry_run, script=custom_run_script: _run_generated_stage_script(
                script, dry_run
            ),
        )

    custom_stop_script = custom_stage_scripts.get(LaunchStage.STOP)
    if custom_stop_script is not None:
        run = replace(
            run,
            strategy=LOCAL_STRATEGY,
            stop_handler=lambda dry_run, script=custom_stop_script: _run_generated_stage_script(
                script, dry_run
            ),
        )

    return TargetPlan(
        project=project,
        model=model,
        target=target,
        target_platform=target_platform,
        target_variant=target_variant,
        build=build,
        deploy=deploy,
        run=run,
    )
