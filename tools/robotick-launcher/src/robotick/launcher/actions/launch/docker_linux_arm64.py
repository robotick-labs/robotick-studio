from __future__ import annotations

import hashlib
import os
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from rich import print

from robotick.launcher.config import Config
from robotick.launcher.utils import get_launcher_paths, run_subprocess


IMAGE_NAME = "robotick-dev-linux-arm64"
DOCKERFILE_SHA_LABEL = "robotick.dockerfile_sha"
CONTAINER_NAME_PREFIX = "robotick-launcher-linux-arm64-build"


@dataclass(frozen=True)
class DockerLinuxArm64Spec:
    image_name: str
    dockerfile: Path
    container_name: str
    local_repo_root: Path
    local_launcher_dir: Path
    local_binary_path: Path
    container_workspace_root: str
    container_launcher_dir: str
    container_binary_path: str


def load_docker_linux_arm64_spec(
    project: str,
    model: str,
    target: str,
    base_dir: Path,
) -> Optional[DockerLinuxArm64Spec]:
    if target != "linux":
        return None

    config = Config(project, model, target, base_dir, dry_run=False, stub_install=False)
    runtime = dict(config.model.get("runtime") or {})
    if (runtime.get("target_platform") or "").strip() != "linux":
        return None

    target_variant = (runtime.get("target_variant") or "").strip().lower()
    if target_variant not in {"arm64", "aarch64"}:
        return None

    repo_root = _compute_local_repo_root(config)
    launcher_dir, _, binary_path = get_launcher_paths(project, model, target, base_dir)
    launcher_rel = launcher_dir.resolve().relative_to(repo_root)
    binary_rel = binary_path.resolve().relative_to(repo_root)

    dockerfile = (
        Path(__file__).resolve().parents[5]
        / "docker"
        / "linux-arm64.Dockerfile"
    )

    # Mount the repo at the same absolute path inside the container so generated CMake
    # caches can be reused across host/docker rebuilds without path-mismatch errors.
    container_root = repo_root.as_posix()
    return DockerLinuxArm64Spec(
        image_name=IMAGE_NAME,
        dockerfile=dockerfile,
        container_name=_build_container_name(IMAGE_NAME, repo_root),
        local_repo_root=repo_root,
        local_launcher_dir=launcher_dir.resolve(),
        local_binary_path=binary_path.resolve(),
        container_workspace_root=container_root,
        container_launcher_dir=f"{container_root}/{launcher_rel.as_posix()}",
        container_binary_path=f"{container_root}/{binary_rel.as_posix()}",
    )


def print_docker_linux_arm64_summary(spec: DockerLinuxArm64Spec) -> None:
    print(f"[cyan]🐳 Docker image:     [/] {spec.image_name}")
    print(f"[cyan]📦 Docker container: [/] {spec.container_name}")
    print(f"[cyan]🧱 Dockerfile:      [/] {spec.dockerfile}")
    print(f"[cyan]🗂️ Workspace root:  [/] {spec.local_repo_root}")
    print(f"[cyan]📁 Launcher dir:    [/] {spec.local_launcher_dir}")
    print(f"[cyan]🚀 Binary path:     [/] {spec.local_binary_path}")


def build_docker_linux_arm64(spec: DockerLinuxArm64Spec, *, dry_run: bool) -> None:
    ensure_running_docker_linux_arm64_container(spec, dry_run=dry_run)

    uid = os.getuid()
    gid = os.getgid()
    run_cmd = [
        "docker",
        "exec",
        "--user",
        f"{uid}:{gid}",
        "-e",
        "HOME=/tmp/robotick-home",
        "-w",
        spec.container_launcher_dir,
        spec.container_name,
        "bash",
        "-lc",
        "bash ./do_launcher_build.sh",
    ]
    _print_command(run_cmd)
    if not dry_run:
        run_subprocess(run_cmd)


def ensure_docker_image(spec: DockerLinuxArm64Spec, *, dry_run: bool) -> None:
    inspect_cmd = ["docker", "image", "inspect", spec.image_name]
    current_sha = hashlib.sha256(spec.dockerfile.read_bytes()).hexdigest()
    image_exists = subprocess.run(
        inspect_cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    ).returncode == 0
    if image_exists:
        label_cmd = [
            "docker",
            "image",
            "inspect",
            "-f",
            f"{{{{ index .Config.Labels \"{DOCKERFILE_SHA_LABEL}\" }}}}",
            spec.image_name,
        ]
        label_result = subprocess.run(
            label_cmd,
            check=False,
            capture_output=True,
            text=True,
        )
        existing_sha = label_result.stdout.strip()
        if existing_sha == current_sha:
            return

    build_cmd = [
        "docker",
        "build",
        "-t",
        spec.image_name,
        "--label",
        f"{DOCKERFILE_SHA_LABEL}={current_sha}",
        "-f",
        str(spec.dockerfile),
        str(spec.dockerfile.parent),
    ]
    _print_command(build_cmd)
    if not dry_run:
        run_subprocess(build_cmd)


def ensure_running_docker_linux_arm64_container(
    spec: DockerLinuxArm64Spec, *, dry_run: bool
) -> None:
    ensure_docker_image(spec, dry_run=dry_run)

    image_id = _inspect_docker_value(
        ["docker", "image", "inspect", "-f", "{{.Id}}", spec.image_name]
    )
    container_image_id = _inspect_docker_value(
        ["docker", "container", "inspect", "-f", "{{.Image}}", spec.container_name]
    )
    if container_image_id and image_id and container_image_id != image_id:
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
            "-v",
            f"{spec.local_repo_root}:{spec.container_workspace_root}",
            "-w",
            spec.container_workspace_root,
            spec.image_name,
            "sleep",
            "infinity",
        ]
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


def _compute_local_repo_root(config: Config) -> Path:
    local_paths = [config.project_dir.resolve()]

    engine = dict((config.runtime or {}).get("engine") or {})
    engine_local_path = engine.get("local_path")
    if engine_local_path:
        local_paths.append(config.resolve_project_path(engine_local_path))

    for category in ("workload_sources", "shared"):
        for entry in (config.runtime or {}).get(category) or []:
            entry_dict = dict(entry)
            local_path = entry_dict.get("local_path")
            if not local_path:
                continue
            source_root = config.resolve_project_path(local_path)
            root_paths = entry_dict.get("root_paths") or []
            if root_paths:
                for root_path in root_paths:
                    candidate = (source_root / root_path).resolve()
                    if candidate.exists():
                        local_paths.append(candidate)
            else:
                local_paths.append(source_root)

    # The docker workspace only needs the minimal common root that covers the project,
    # engine, and the declared workload source roots used by generation/build.
    return Path(os.path.commonpath([str(path) for path in local_paths])).resolve()


def _print_command(command: Iterable[str]) -> None:
    print(f"[bold]$ {' '.join(shlex.quote(part) for part in command)}[/]")


def _inspect_docker_value(command: list[str]) -> str:
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def _build_container_name(image_name: str, repo_root: Path) -> str:
    scope_hash = hashlib.sha256(
        f"{image_name}:{repo_root.resolve()}".encode("utf-8")
    ).hexdigest()[:12]
    return f"{CONTAINER_NAME_PREFIX}-{scope_hash}"
