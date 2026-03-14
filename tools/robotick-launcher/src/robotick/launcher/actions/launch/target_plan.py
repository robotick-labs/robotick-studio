from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from robotick.launcher.actions.launch.docker_linux_arm64 import (
    load_docker_linux_arm64_spec,
    print_docker_linux_arm64_summary,
    build_docker_linux_arm64,
)
from robotick.launcher.actions.launch.remote_linux import (
    load_remote_linux_spec,
    print_remote_linux_summary,
    build_remote_linux,
    sync_remote_linux_project,
    stop_remote_linux_process,
    run_remote_linux,
)
from robotick.launcher.config import Config


LOCAL_STRATEGY = "local"
CONTAINER_STRATEGY = "container"
REMOTE_STRATEGY = "remote"


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

    container_spec = load_docker_linux_arm64_spec(project, model, target, base_dir)
    remote_spec = load_remote_linux_spec(project, model, target, base_dir)

    build = TargetActionPlan(strategy=LOCAL_STRATEGY)
    deploy = TargetActionPlan(strategy=LOCAL_STRATEGY)
    run = TargetActionPlan(strategy=LOCAL_STRATEGY)

    if container_spec:
        build = TargetActionPlan(
            strategy=CONTAINER_STRATEGY,
            summary_printer=lambda spec=container_spec: print_docker_linux_arm64_summary(spec),
            build_handler=lambda dry_run, spec=container_spec: build_docker_linux_arm64(
                spec, dry_run=dry_run
            ),
            local_binary_path=container_spec.local_binary_path,
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
        remote_action = TargetActionPlan(
            strategy=REMOTE_STRATEGY,
            summary_printer=lambda spec=remote_spec: print_remote_linux_summary(spec),
            deploy_handler=lambda dry_run, spec=remote_spec: sync_remote_linux_project(
                spec, dry_run=dry_run
            ),
            stop_handler=lambda dry_run, spec=remote_spec: stop_remote_linux_process(
                spec, dry_run=dry_run
            ),
            run_handler=lambda dry_run, spec=remote_spec: run_remote_linux(
                spec, dry_run=dry_run
            ),
            display_binary_path=remote_spec.remote_binary_path,
        )
        deploy = remote_action
        run = remote_action

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
