"""Generic Docker-backed launcher execution for Linux targets.

The launcher's Python layer should stay mostly orchestration-focused: resolve
which target family a model belongs to, mount the right workspace root, and
invoke the generated shell scripts inside the correct container. The real
target-specific work still lives in the generated shell scripts and image
selection config below.
"""

from __future__ import annotations

import hashlib
import os
import shlex
import subprocess
import grp
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from rich import print

from robotick.launcher.config import Config
from robotick.launcher.actions.launch.prepare_project_docker import (
    load_prepared_project_docker_info,
    project_cache_materialize_shell,
)
from robotick.launcher.utils import get_launcher_paths, run_subprocess


X64_TARGET_VARIANTS = {"", "x64", "x86_64", "amd64", "native"}
ARM64_TARGET_VARIANTS = {"arm64", "aarch64"}
ARM32_TARGET_VARIANTS = {"arm32", "armhf", "armv7", "armv7hf"}


@dataclass(frozen=True)
class DockerLinuxFamilyConfig:
    family: str
    accepted_variants: frozenset[str]
    default_image: str
    dockerfile_name: str
    container_name_prefix: str
    supports_runtime: bool
    use_host_network: bool = False


FAMILY_CONFIGS: tuple[DockerLinuxFamilyConfig, ...] = (
    DockerLinuxFamilyConfig(
        family="linux-x64",
        accepted_variants=frozenset(X64_TARGET_VARIANTS),
        default_image="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile_name="robotick-ubuntu24.04-native-linux.Dockerfile",
        container_name_prefix="robotick-launcher-linux-x64-build",
        supports_runtime=True,
        use_host_network=True,
    ),
    DockerLinuxFamilyConfig(
        family="linux-arm64",
        accepted_variants=frozenset(ARM64_TARGET_VARIANTS),
        default_image="ghcr.io/robotick-labs/robotick-debian12-cross-linux-arm64:latest",
        dockerfile_name="robotick-debian12-cross-linux-arm64.Dockerfile",
        container_name_prefix="robotick-launcher-linux-arm64-build",
        supports_runtime=False,
    ),
    DockerLinuxFamilyConfig(
        family="linux-arm32",
        accepted_variants=frozenset(ARM32_TARGET_VARIANTS),
        default_image="ghcr.io/robotick-labs/robotick-debian12-cross-linux-arm32:latest",
        dockerfile_name="robotick-debian12-cross-linux-arm32.Dockerfile",
        container_name_prefix="robotick-launcher-linux-arm32-build",
        supports_runtime=False,
    ),
)
FAMILY_CONFIG_BY_NAME = {config.family: config for config in FAMILY_CONFIGS}


@dataclass(frozen=True)
class DockerLinuxSpec:
    family: str
    image_name: str
    dockerfile: Path
    container_name: str
    local_repo_root: Path
    local_launcher_dir: Path
    local_binary_path: Path
    container_workspace_root: str
    container_launcher_dir: str
    container_working_dir: str
    container_binary_path: str
    supports_runtime: bool
    use_host_network: bool


def load_docker_linux_spec(
    project: str,
    model: str,
    target: str,
    base_dir: Path,
    *,
    config: Optional[Config] = None,
) -> Optional[DockerLinuxSpec]:
    """Build the container execution spec for a Linux launcher target family."""

    if target != "linux":
        return None

    config = config or Config(
        project, model, target, base_dir, dry_run=False, stub_install=False
    )
    runtime = dict(config.model.get("runtime") or {})
    target_platform = str(runtime.get("target_platform") or target).strip().lower()
    if target_platform != "linux":
        return None

    target_variant = (runtime.get("target_variant") or "").strip().lower()
    family_config = _resolve_family_config(target_variant)
    if family_config is None:
        return None

    repo_root = _compute_local_repo_root(config)
    launcher_dir, _, binary_path = get_launcher_paths(project, model, target, base_dir)
    launcher_rel = launcher_dir.resolve().relative_to(repo_root)
    binary_rel = binary_path.resolve().relative_to(repo_root)

    working_dir = config.project_dir.resolve()
    working_dir_value = str(config.project.get("working_dir") or ".").strip()
    if working_dir_value and working_dir_value != ".":
        candidate = Path(working_dir_value)
        if not candidate.is_absolute():
            candidate = (config.project_dir / candidate).resolve()
        working_dir = candidate
    working_dir_rel = working_dir.resolve().relative_to(repo_root)

    prepared_project_docker = load_prepared_project_docker_info(
        project, model, target, base_dir
    )
    engine_root = _resolve_engine_root(config, repo_root)
    dockerfile = engine_root / "tools" / "docker" / family_config.dockerfile_name

    container_root = repo_root.as_posix()
    image_name = (
        prepared_project_docker.image_name
        if prepared_project_docker
        else family_config.default_image
    )
    return DockerLinuxSpec(
        family=family_config.family,
        image_name=image_name,
        dockerfile=dockerfile,
        container_name=_build_container_name(
            family_config.container_name_prefix,
            image_name,
            repo_root,
            launcher_dir.resolve(),
        ),
        local_repo_root=repo_root,
        local_launcher_dir=launcher_dir.resolve(),
        local_binary_path=binary_path.resolve(),
        container_workspace_root=container_root,
        container_launcher_dir=f"{container_root}/{launcher_rel.as_posix()}",
        container_working_dir=f"{container_root}/{working_dir_rel.as_posix()}",
        container_binary_path=f"{container_root}/{binary_rel.as_posix()}",
        supports_runtime=family_config.supports_runtime,
        use_host_network=family_config.use_host_network,
    )


def print_docker_linux_summary(spec: DockerLinuxSpec) -> None:
    print(f"[cyan]🧭 Target family:   [/] {spec.family}")
    print(f"[cyan]🐳 Docker image:     [/] {spec.image_name}")
    print(f"[cyan]📦 Docker container: [/] {spec.container_name}")
    print(f"[cyan]🧱 Dockerfile:      [/] {spec.dockerfile}")
    print(f"[cyan]🗂️ Workspace root:  [/] {spec.local_repo_root}")
    print(f"[cyan]📁 Launcher dir:    [/] {spec.local_launcher_dir}")
    print(f"[cyan]🚀 Binary path:     [/] {spec.local_binary_path}")


def build_docker_linux(spec: DockerLinuxSpec, *, dry_run: bool) -> None:
    ensure_running_docker_linux_container(spec, dry_run=dry_run)
    _materialize_project_cache(spec, dry_run=dry_run)
    run_cmd = _docker_exec_command(
        spec,
        spec.container_launcher_dir,
        "bash ./do_launcher_build.sh",
    )
    _run_docker_exec(run_cmd, dry_run=dry_run)


def deploy_docker_linux(spec: DockerLinuxSpec, *, dry_run: bool) -> None:
    _require_runtime_support(spec, stage="deploy")
    ensure_running_docker_linux_container(spec, dry_run=dry_run)
    run_cmd = _docker_exec_command(
        spec,
        spec.container_workspace_root,
        f"test -f {shlex.quote(spec.container_binary_path)}",
    )
    _run_docker_exec(run_cmd, dry_run=dry_run)


def stop_docker_linux(spec: DockerLinuxSpec, *, dry_run: bool) -> None:
    _require_runtime_support(spec, stage="stop")
    if spec.use_host_network:
        remove_cmd = ["docker", "rm", "-f", _runtime_container_name(spec)]
        if dry_run:
            _print_command(remove_cmd)
        if not dry_run:
            subprocess.run(
                remove_cmd,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        return
    ensure_running_docker_linux_container(spec, dry_run=dry_run)
    binary_path = shlex.quote(spec.container_binary_path)
    # Match live processes by /proc/*/exe rather than pkill -f. The old
    # command-line match could kill the shell running this stop helper because
    # the binary path itself appeared inside the helper's command string.
    stop_cmd = (
        f"binary_path={binary_path}; "
        'matching_pids=(); '
        "for proc_dir in /proc/[0-9]*; do "
        '  pid=${proc_dir##*/}; '
        '  exe=$(readlink -f "$proc_dir/exe" 2>/dev/null || true); '
        '  [[ "$exe" == "$binary_path" ]] || continue; '
        '  matching_pids+=("$pid"); '
        "done; "
        'if ((${#matching_pids[@]})); then '
        '  echo "[Launcher] Stopping existing container instance: $binary_path"; '
        '  kill -TERM "${matching_pids[@]}" 2>/dev/null || true; '
        "  for i in $(seq 1 25); do "
        "    still_running=0; "
        '    for pid in "${matching_pids[@]}"; do '
        '      [[ -e "/proc/$pid/exe" ]] && still_running=1 && break; '
        "    done; "
        '    (( still_running == 0 )) && exit 0; '
        "    sleep 0.2; "
        "  done; "
        '  kill -KILL "${matching_pids[@]}" 2>/dev/null || true; '
        "fi; true"
    )
    run_cmd = _docker_exec_command(spec, spec.container_working_dir, stop_cmd)
    _run_docker_exec(run_cmd, dry_run=dry_run)


def run_docker_linux(spec: DockerLinuxSpec, *, dry_run: bool) -> None:
    _require_runtime_support(spec, stage="run")
    if spec.use_host_network:
        ensure_docker_image(spec, dry_run=dry_run)
        remove_cmd = ["docker", "rm", "-f", _runtime_container_name(spec)]
        _print_command(remove_cmd)
        if not dry_run:
            subprocess.run(
                remove_cmd,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        binary_dir = Path(spec.container_binary_path).parent.as_posix()
        engine_lib_dir = f"{binary_dir}/robotick_engine/cpp"
        run_cmd = _docker_run_command(
            spec,
            spec.container_working_dir,
            (
                f"export LD_LIBRARY_PATH={shlex.quote(engine_lib_dir)}:{shlex.quote(binary_dir)}:$LD_LIBRARY_PATH && "
                "if [[ -f ./do_launcher_run.sh ]]; then "
                "bash ./do_launcher_run.sh; "
                "else "
                f"{shlex.quote(spec.container_binary_path)}; "
                "fi"
            ),
        )
        _run_docker_exec(run_cmd, dry_run=dry_run)
        return
    ensure_running_docker_linux_container(spec, dry_run=dry_run)
    binary_dir = Path(spec.container_binary_path).parent.as_posix()
    engine_lib_dir = f"{binary_dir}/robotick_engine/cpp"
    run_cmd = _docker_exec_command(
        spec,
        spec.container_working_dir,
        (
            f"export LD_LIBRARY_PATH={shlex.quote(engine_lib_dir)}:{shlex.quote(binary_dir)}:$LD_LIBRARY_PATH && "
            "if [[ -f ./do_launcher_run.sh ]]; then "
            "bash ./do_launcher_run.sh; "
            "else "
            f"{shlex.quote(spec.container_binary_path)}; "
            "fi"
        ),
    )
    _run_docker_exec(run_cmd, dry_run=dry_run)


def ensure_docker_image(spec: DockerLinuxSpec, *, dry_run: bool) -> None:
    if spec.image_name.endswith(":latest"):
        if _docker_image_exists(spec.image_name) and os.environ.get(
            "ROBOTICK_LAUNCHER_REFRESH_DOCKER_LATEST", "0"
        ) != "1":
            print(
                "[Launcher] Reusing local Docker image "
                f"{spec.image_name} (set ROBOTICK_LAUNCHER_REFRESH_DOCKER_LATEST=1 to refresh)"
            )
            return
        pull_cmd = ["docker", "pull", spec.image_name]
        _print_command(pull_cmd)
        if not dry_run:
            run_subprocess(pull_cmd)
        return

    if _docker_image_exists(spec.image_name):
        return

    pull_cmd = ["docker", "pull", spec.image_name]
    _print_command(pull_cmd)
    if not dry_run:
        run_subprocess(pull_cmd)


def ensure_running_docker_linux_container(
    spec: DockerLinuxSpec, *, dry_run: bool
) -> None:
    ensure_docker_image(spec, dry_run=dry_run)

    image_id = _inspect_docker_value(
        ["docker", "image", "inspect", "-f", "{{.Id}}", spec.image_name]
    )
    container_image_id = _inspect_docker_value(
        ["docker", "container", "inspect", "-f", "{{.Image}}", spec.container_name]
    )
    container_network_mode = _inspect_docker_value(
        [
            "docker",
            "container",
            "inspect",
            "-f",
            "{{.HostConfig.NetworkMode}}",
            spec.container_name,
        ]
    )
    expected_network_mode = "host" if spec.use_host_network else "default"
    if (
        container_image_id
        and image_id
        and container_image_id != image_id
        or (
            container_image_id
            and container_network_mode
            and container_network_mode != expected_network_mode
        )
    ):
        remove_cmd = ["docker", "rm", "-f", spec.container_name]
        _print_command(remove_cmd)
        if not dry_run:
            subprocess.run(
                remove_cmd,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        container_image_id = ""

    if not container_image_id:
        create_cmd = [
            "docker",
            "create",
            "--name",
            spec.container_name,
            "--init",
        ]
        # Native Linux launcher runs should look native from the host's point of
        # view: Studio probes telemetry from the host, and the model processes
        # themselves already assume a "local Linux" contract. Host networking
        # keeps those telemetry ports reachable without adding per-model port
        # publication plumbing to the generic launcher path.
        if spec.use_host_network:
            create_cmd.extend(["--network", "host"])
        create_cmd.extend(
            [
                "-v",
                f"{spec.local_repo_root}:{spec.container_workspace_root}",
                "-w",
                spec.container_workspace_root,
                spec.image_name,
                "sleep",
                "infinity",
            ]
        )
        _print_command(create_cmd)
        if not dry_run:
            subprocess.run(
                create_cmd,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

    container_state = _inspect_docker_value(
        ["docker", "container", "inspect", "-f", "{{.State.Status}}", spec.container_name]
    )
    if container_state != "running":
        start_cmd = ["docker", "start", spec.container_name]
        _print_command(start_cmd)
        if not dry_run:
            subprocess.run(
                start_cmd,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )


def _resolve_family_config(target_variant: str) -> Optional[DockerLinuxFamilyConfig]:
    for config in FAMILY_CONFIGS:
        if target_variant in config.accepted_variants:
            return config
    return None


def _require_runtime_support(spec: DockerLinuxSpec, *, stage: str) -> None:
    if spec.supports_runtime:
        return
    raise RuntimeError(f"Docker Linux family '{spec.family}' does not support {stage}.")


def _materialize_project_cache(spec: DockerLinuxSpec, *, dry_run: bool) -> None:
    """Copy image-side cached deps back into the bind-mounted launcher folder."""

    command = _docker_exec_command(
        spec,
        spec.container_workspace_root,
        project_cache_materialize_shell(spec.container_launcher_dir, subdir="deps"),
    )
    _run_docker_exec(command, dry_run=dry_run)


def _compute_local_repo_root(config: Config) -> Path:
    """Find the common host path that must be bind-mounted into the container.

    We mount one shared root that covers the project itself plus any local
    runtime repos the generated launcher files reference.
    """

    local_paths = [config.project_dir.resolve()]

    engine = dict((config.runtime or {}).get("engine") or {})
    engine_local_path = engine.get("local_path")
    if engine_local_path:
        local_paths.append(_resolve_project_mount_path(config, engine_local_path))

    for category in ("workload_sources", "shared"):
        for entry in (config.runtime or {}).get(category) or []:
            entry_dict = dict(entry)
            local_path = entry_dict.get("local_path")
            if not local_path:
                continue
            source_root = _resolve_project_mount_path(config, local_path)
            root_paths = entry_dict.get("root_paths") or []
            if root_paths:
                for root_path in root_paths:
                    candidate = source_root / root_path
                    if candidate.exists():
                        local_paths.append(candidate)
            else:
                local_paths.append(source_root)

    return Path(os.path.commonpath([str(path) for path in local_paths])).resolve()


def _resolve_engine_root(config: Config, repo_root: Path) -> Path:
    engine = dict((config.runtime or {}).get("engine") or {})
    engine_local_path = engine.get("local_path")
    if engine_local_path:
        return _resolve_project_mount_path(config, engine_local_path)
    return repo_root / "robotick" / "robotick-engine"


def _resolve_project_mount_path(config: Config, raw: str) -> Path:
    value = str(raw).replace("${PROJECT_DIR}", str(config.project_dir))
    path = Path(value)
    if not path.is_absolute():
        path = config.base_dir / path
    return Path(os.path.abspath(path))


def _print_command(command: Iterable[str]) -> None:
    print(f"[bold]$ {' '.join(shlex.quote(part) for part in command)}[/]")


def _resolve_docker_exec_user() -> str:
    """Return a stable uid:gid string for docker exec.

    Most local Linux/macOS environments expose os.getuid()/os.getgid(), which
    lets the container write files back to the bind-mounted workspace with the
    caller's ownership. Some platforms, notably Windows, do not provide those
    APIs. In that case we still return a valid --user value so the command can
    be constructed consistently, falling back to environment overrides before a
    conservative 1000:1000 default.
    """

    try:
        uid = os.getuid()
        gid = os.getgid()
    except AttributeError:
        uid = os.environ.get("ROBOTICK_DOCKER_UID", "1000")
        gid = os.environ.get("ROBOTICK_DOCKER_GID", "1000")
    return f"{uid}:{gid}"


def _docker_exec_command(
    spec: DockerLinuxSpec,
    working_dir: str,
    shell_command: str,
) -> list[str]:
    """Build a docker exec command that preserves host file ownership."""

    return [
        "docker",
        "exec",
        "--user",
        _resolve_docker_exec_user(),
        "-e",
        "HOME=/tmp/robotick-home",
        "-w",
        working_dir,
        spec.container_name,
        "bash",
        "-lc",
        shell_command,
    ]


def _docker_run_command(
    spec: DockerLinuxSpec,
    working_dir: str,
    shell_command: str,
) -> list[str]:
    runtime_shell_command = _prepare_runtime_shell_command(spec, shell_command)
    return [
        "docker",
        "run",
        "--name",
        _runtime_container_name(spec),
        "--init",
        "--network",
        "host",
        "--user",
        _resolve_docker_exec_user(),
        *_runtime_group_add_args(spec),
        "-e",
        "HOME=/tmp/robotick-home",
        "-e",
        "XDG_RUNTIME_DIR=/tmp/robotick-xdg-runtime",
        "-v",
        f"{spec.local_repo_root}:{spec.container_workspace_root}",
        *_runtime_device_args(spec),
        "-w",
        working_dir,
        spec.image_name,
        "bash",
        "-lc",
        runtime_shell_command,
    ]


def _run_docker_exec(command: list[str], *, dry_run: bool) -> None:
    _print_command(command)
    if not dry_run:
        run_subprocess(command)


def _runtime_container_name(spec: DockerLinuxSpec) -> str:
    return f"{spec.container_name}-run"


def _runtime_device_args(spec: DockerLinuxSpec) -> list[str]:
    """Expose local media/audio devices to native Linux runtime containers.

    The build-stage keepalive containers do not need host devices, but native
    local runtime models do. Without these mappings the auditory and visual
    Barr.e workloads can start inside Docker yet fail immediately because ALSA
    and V4L cannot see the host's microphone/camera nodes.
    """

    if not spec.use_host_network:
        return []

    args: list[str] = []

    for device_dir in (Path("/dev/snd"), Path("/dev/dri")):
        if not device_dir.exists():
            continue
        for device in sorted(device_dir.iterdir()):
            try:
                mode = device.stat().st_mode
            except FileNotFoundError:
                continue
            if not stat.S_ISCHR(mode) and not stat.S_ISBLK(mode):
                continue
            args.extend(["--device", f"{device}:{device}"])

    for pattern in ("/dev/video*", "/dev/media*"):
        for device in sorted(Path("/dev").glob(pattern.removeprefix("/dev/"))):
            args.extend(["--device", f"{device}:{device}"])

    return args


def _runtime_group_add_args(spec: DockerLinuxSpec) -> list[str]:
    """Grant runtime containers the host device groups their bind-mounted devices use.

    Docker `--device` mappings preserve the node owner/group, but they do not carry over
    the host user's ACL entries. For local media/audio models that means a container user
    matching the caller's uid/gid still cannot open `/dev/snd` or `/dev/video*` unless we
    add the relevant host groups explicitly.
    """

    if not spec.use_host_network:
        return []

    group_names: list[str] = []
    if Path("/dev/snd").exists():
        group_names.append("audio")
    if any(Path("/dev").glob("video*")) or any(Path("/dev").glob("media*")):
        group_names.append("video")
    if Path("/dev/dri").exists():
        group_names.append("render")

    args: list[str] = []
    for group_name in group_names:
        gid = _lookup_group_gid(group_name)
        if gid is not None:
            args.extend(["--group-add", str(gid)])
    return args


def _lookup_group_gid(group_name: str) -> Optional[int]:
    try:
        return grp.getgrnam(group_name).gr_gid
    except KeyError:
        return None


def _prepare_runtime_shell_command(spec: DockerLinuxSpec, shell_command: str) -> str:
    """Bootstrap small host-runtime conveniences before the model process starts.

    Native local models are launched inside short-lived `docker run` containers. Some
    host integrations therefore need a tiny bit of runtime setup inside that container,
    rather than baked into the shared base image:

    - a writable HOME/XDG runtime dir for libraries that expect them
    - a minimal ALSA default-device config so audio workloads can use the first local
      playback/capture card when `/dev/snd` is present
    """

    if not spec.use_host_network:
        return shell_command

    setup_lines = [
        "set -e",
        'mkdir -p "$HOME" "$XDG_RUNTIME_DIR"',
        'chmod 700 "$XDG_RUNTIME_DIR" || true',
    ]
    if Path("/dev/snd").exists():
        setup_lines.append(
            """cat > "$HOME/.asoundrc" <<'EOF'
pcm.!default {
  type asym
  playback.pcm "playback"
  capture.pcm "capture"
}
pcm.playback {
  type plug
  slave.pcm "hw:0,0"
}
pcm.capture {
  type plug
  slave.pcm "hw:0,0"
}
ctl.!default {
  type hw
  card 0
}
EOF"""
        )
    setup_lines.append(shell_command)
    return "\n".join(setup_lines)


def _docker_image_exists(image_name: str) -> bool:
    try:
        result = subprocess.run(
            ["docker", "image", "inspect", image_name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except FileNotFoundError:
        return False
    return result.returncode == 0


def _inspect_docker_value(command: list[str]) -> str:
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def _build_container_name(
    prefix: str,
    image_name: str,
    repo_root: Path,
    launcher_dir: Path,
) -> str:
    scope_hash = hashlib.sha256(
        f"{image_name}|{repo_root}|{launcher_dir}".encode("utf-8")
    ).hexdigest()[:12]
    return f"{prefix}-{scope_hash}"
