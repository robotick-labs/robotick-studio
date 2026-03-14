from __future__ import annotations

import platform
import shlex
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from rich import print

from robotick.launcher.config import Config
from robotick.launcher.utils import get_launcher_paths, run_subprocess


@dataclass(frozen=True)
class RemoteSyncPath:
    local_path: Path
    remote_path: str


@dataclass(frozen=True)
class RemoteLinuxSpec:
    host: str
    target_variant: str
    local_project_dir: Path
    remote_repo_root: str
    remote_project_dir: str
    remote_working_dir: str
    remote_launcher_dir: str
    remote_binary_path: str
    sync_paths: tuple[RemoteSyncPath, ...]


def load_remote_linux_spec(
    project: str,
    model: str,
    target: str,
    base_dir: Path,
) -> Optional[RemoteLinuxSpec]:
    if target != "linux":
        return None

    config = Config(project, model, target, base_dir, dry_run=False, stub_install=False)
    runtime = dict(config.model.get("runtime") or {})
    if (runtime.get("target_platform") or "").strip() != "linux":
        return None

    target_variant = (runtime.get("target_variant") or "").strip().lower()
    if target_variant not in {"arm64", "aarch64"}:
        return None

    host = (runtime.get("preferred_host") or "").strip()
    if not host or host in {"localhost", "127.0.0.1"}:
        return None

    # An arm64 host can still launch "native linux" locally; only treat it as remote when
    # the configured host points somewhere else.
    if _looks_local_host(host) and platform.machine().lower() in {"arm64", "aarch64"}:
        return None

    deploy = dict(runtime.get("deploy") or {})
    remote_repo_root = _normalize_remote_root(
        str(
            deploy.get("remote_project_path")
            or deploy.get("remote_workspace_path")
            or f"$HOME/dev/robotick/{config.project_dir.parent.parent.name}"
        ).strip()
    )

    sync_paths, local_repo_root = _build_sync_paths(config, remote_repo_root)

    relative_project_dir = config.project_dir.resolve().relative_to(local_repo_root)
    remote_project_dir = _join_remote(remote_repo_root, relative_project_dir.as_posix())

    launcher_dir, _, binary_path = get_launcher_paths(project, model, target, base_dir)
    relative_launcher_dir = launcher_dir.relative_to(local_repo_root)
    relative_binary_path = binary_path.relative_to(local_repo_root)

    project_data = dict(config.project)
    working_dir_value = str(project_data.get("working_dir") or ".").strip()
    local_working_dir = config.project_dir
    if working_dir_value and working_dir_value != ".":
        candidate = Path(working_dir_value)
        if not candidate.is_absolute():
            candidate = (config.project_dir / candidate).resolve()
        local_working_dir = candidate
    relative_working_dir = local_working_dir.relative_to(local_repo_root)

    return RemoteLinuxSpec(
        host=host,
        target_variant=target_variant,
        local_project_dir=config.project_dir.resolve(),
        remote_repo_root=remote_repo_root,
        remote_project_dir=remote_project_dir,
        remote_working_dir=_join_remote(remote_repo_root, relative_working_dir.as_posix()),
        remote_launcher_dir=_join_remote(
            remote_repo_root, relative_launcher_dir.as_posix()
        ),
        remote_binary_path=_join_remote(
            remote_repo_root, relative_binary_path.as_posix()
        ),
        sync_paths=tuple(sync_paths),
    )


def print_remote_linux_summary(spec: RemoteLinuxSpec) -> None:
    print(f"[cyan]🌐 Remote host:      [/] {spec.host}")
    print(f"[cyan]🧭 Target variant:  [/] {spec.target_variant}")
    print(f"[cyan]📦 Remote repo root:[/] {spec.remote_repo_root}")
    print(f"[cyan]📂 Remote project:   [/] {spec.remote_project_dir}")
    print(f"[cyan]🚀 Remote binary:    [/] {spec.remote_binary_path}")
    print("[cyan]🔁 Sync roots:[/]")
    for sync_path in spec.sync_paths:
        print(f"  - {sync_path.local_path} -> {sync_path.remote_path}")


def sync_remote_linux_repo(spec: RemoteLinuxSpec, *, dry_run: bool) -> None:
    mkdir_cmds = sorted(
        {
            _parent_remote_dir(spec.remote_repo_root),
            *(_parent_remote_dir(sync.remote_path) for sync in spec.sync_paths),
        }
    )
    for remote_dir in mkdir_cmds:
        cmd = [
            "ssh",
            spec.host,
            f"mkdir -p {_remote_shell_path(remote_dir)}",
        ]
        _print_command(cmd)
        if not dry_run:
            run_subprocess(cmd)

    excludes = [
        ".git/",
        ".studio/",
        ".venv/",
        ".venv*/",
        "__pycache__/",
        ".pytest_cache/",
        "build/",
    ]
    # Remote native builds should sync just the declared source roots and avoid local build
    # outputs, so the target host owns its own build directory.
    for sync in spec.sync_paths:
        cmd = ["rsync", "-az", "--delete"]
        for pattern in excludes:
            cmd.extend(["--exclude", pattern])
        cmd.extend(
            [
                f"{sync.local_path}/",
                f"{spec.host}:{_remote_rsync_path(sync.remote_path)}/",
            ]
        )
        _print_command(cmd)
        if not dry_run:
            run_subprocess(cmd)


def sync_remote_linux_project(spec: RemoteLinuxSpec, *, dry_run: bool) -> None:
    mkdir_cmd = [
        "ssh",
        spec.host,
        f"mkdir -p {_remote_shell_path(_parent_remote_dir(spec.remote_project_dir))}",
    ]
    _print_command(mkdir_cmd)
    if not dry_run:
        run_subprocess(mkdir_cmd)

    # Deploy syncs the whole project tree on purpose so locally built launcher artifacts
    # (including .launcher/build outputs) arrive on the target host unchanged.
    cmd = [
        "rsync",
        "-az",
        "--delete",
        "--exclude",
        ".git/",
        "--exclude",
        ".studio/",
        "--exclude",
        ".venv/",
        "--exclude",
        ".venv*/",
        "--exclude",
        "__pycache__/",
        "--exclude",
        ".pytest_cache/",
        f"{spec.local_project_dir}/",
        f"{spec.host}:{_remote_rsync_path(spec.remote_project_dir)}/",
    ]
    _print_command(cmd)
    if not dry_run:
        run_subprocess(cmd)


def build_remote_linux(spec: RemoteLinuxSpec, *, dry_run: bool) -> None:
    sync_remote_linux_repo(spec, dry_run=dry_run)
    cmd = [
        "ssh",
        spec.host,
        (
            f"cd {_remote_shell_path(spec.remote_launcher_dir)} && "
            "bash ./do_launcher_build.sh"
        ),
    ]
    _print_command(cmd)
    if not dry_run:
        run_subprocess(cmd)


def stop_remote_linux_process(spec: RemoteLinuxSpec, *, dry_run: bool) -> None:
    pattern = _remote_shell_path(spec.remote_binary_path)
    cmd = [
        "ssh",
        spec.host,
        (
            f"if pgrep -f -- {pattern} >/dev/null 2>&1; then "
            f"echo '[Launcher] Stopping existing remote instance: {pattern}'; "
            f"pkill -TERM -f -- {pattern} || true; "
            "for i in $(seq 1 25); do "
            f"pgrep -f -- {pattern} >/dev/null 2>&1 || exit 0; "
            "sleep 0.2; "
            "done; "
            f"pkill -KILL -f -- {pattern} || true; "
            "fi; true"
        ),
    ]
    _print_command(cmd)
    if not dry_run:
        run_subprocess(cmd)


def run_remote_linux(spec: RemoteLinuxSpec, *, dry_run: bool) -> None:
    remote_binary_dir = _parent_remote_dir(spec.remote_binary_path)
    remote_engine_lib_dir = _join_remote(remote_binary_dir, "robotick_engine/cpp")
    remote_command = (
        f"cd {_remote_shell_path(spec.remote_working_dir)} && "
        f"export LD_LIBRARY_PATH={_remote_shell_path(remote_engine_lib_dir)}:{_remote_shell_path(remote_binary_dir)}:$LD_LIBRARY_PATH && "
        "child_pid='' && "
        # Run the model as a child of the remote shell so the wrapper can terminate it on
        # shell-level signals instead of depending on SSH session teardown semantics.
        "cleanup() { "
        'if [ -n "$child_pid" ]; then '
        'kill -TERM "$child_pid" 2>/dev/null || true; '
        'wait "$child_pid" 2>/dev/null || true; '
        "fi; "
        "} && "
        "trap cleanup INT TERM HUP EXIT && "
        f"{_remote_shell_path(spec.remote_binary_path)} & "
        "child_pid=$! && "
        'wait "$child_pid"; '
        "exit_code=$?; "
        "trap - INT TERM HUP EXIT; "
        'exit "$exit_code"'
    )
    cmd = [
        "ssh",
        spec.host,
        remote_command,
    ]
    _print_command(cmd)
    if not dry_run:
        run_subprocess(
            cmd,
            # Launcher-side Ctrl-C still issues an explicit remote stop, so stale remote
            # processes do not survive a killed SSH session.
            on_interrupt=lambda: stop_remote_linux_process(spec, dry_run=False),
        )


def _build_sync_paths(config: Config, remote_repo_root: str) -> tuple[list[RemoteSyncPath], Path]:
    local_paths = [config.project_dir.resolve()]

    engine = dict((config.runtime or {}).get("engine") or {})
    engine_local_path = engine.get("local_path")
    if engine_local_path:
        local_paths.append(_resolve_local_path(config.project_dir, engine_local_path))

    for entry in (config.runtime or {}).get("workload_sources") or []:
        entry_dict = dict(entry)
        local_path = entry_dict.get("local_path")
        if local_path:
            source_root = _resolve_local_path(config.project_dir, local_path)
            root_paths = entry_dict.get("root_paths") or []
            if root_paths:
                for root_path in root_paths:
                    candidate = (source_root / root_path).resolve()
                    if candidate.exists():
                        local_paths.append(candidate)
            else:
                local_paths.append(source_root)

    for entry in (config.runtime or {}).get("shared") or []:
        local_path = dict(entry).get("local_path")
        if local_path:
            local_paths.append(_resolve_local_path(config.project_dir, local_path))

    common_root = Path(
        os.path.commonpath([str(path) for path in local_paths])
    ).resolve()

    # Sync from the shortest shared prefix so remote paths mirror the local repo layout.
    sync_paths: list[RemoteSyncPath] = []
    seen: set[Path] = set()
    for path in _sorted_unique_paths(local_paths):
        if path in seen:
            continue
        seen.add(path)
        relative_path = path.relative_to(common_root)
        sync_paths.append(
            RemoteSyncPath(
                local_path=path,
                remote_path=_join_remote(remote_repo_root, relative_path.as_posix()),
            )
        )

    return sync_paths, common_root


def _resolve_local_path(project_dir: Path, raw_path: str) -> Path:
    replaced = raw_path.replace("${PROJECT_DIR}", str(project_dir))
    candidate = Path(replaced)
    if not candidate.is_absolute():
        candidate = (project_dir / candidate).resolve()
    return candidate.resolve()


def _normalize_remote_root(remote_root: str) -> str:
    if remote_root.startswith("~/"):
        return "$HOME/" + remote_root[2:]
    return remote_root


def _join_remote(root: str, relative_path: str) -> str:
    if not relative_path or relative_path == ".":
        return root.rstrip("/")
    return f"{root.rstrip('/')}/{relative_path.lstrip('/')}"


def _parent_remote_dir(path: str) -> str:
    head, _, _ = path.rstrip("/").rpartition("/")
    return head or path


def _looks_local_host(host: str) -> bool:
    return host in {
        "localhost",
        "127.0.0.1",
        platform.node(),
        f"{platform.node()}.local",
    }


def _print_command(command: Iterable[str]) -> None:
    print(f"[bold]$ {' '.join(shlex.quote(part) for part in command)}[/]")


def _remote_shell_path(path: str) -> str:
    return path.replace("$HOME", "${HOME}")


def _remote_rsync_path(path: str) -> str:
    if path.startswith("$HOME/"):
        return "~/" + path[len("$HOME/") :]
    return path


def _sorted_unique_paths(paths: list[Path]) -> list[Path]:
    return sorted(set(path.resolve() for path in paths), key=lambda path: len(path.parts))
