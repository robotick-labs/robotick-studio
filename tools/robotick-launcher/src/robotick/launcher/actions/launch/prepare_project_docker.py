"""Build and resolve local project-target Docker images for launcher stages.

The launcher now has two separate preparation phases:

- prepare-project-docker: resolves the immutable container environment for a
  specific project/target/family combination.
- prepare-project-workspace: hydrates mutable state under .launcher/... on the
  bind-mounted workspace.

This module owns the first half. It starts from a shared published base image,
materialises any image-level model dependencies into a local Docker build
context, then builds a local-only derived image. The resulting image name is
content-addressed from metadata so that we can cheaply reuse an identical
project-target image on later runs without publishing it to GHCR.
"""

from __future__ import annotations

import hashlib
import json
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from rich import print

from robotick.launcher.actions.launch.sync_dependencies import sync_model_dependencies
from robotick.launcher.actions.query.list import list_project_models
from robotick.launcher.config import Config
from robotick.launcher.utils import run_subprocess, write_text_if_changed


PROJECT_DOCKER_DIRNAME = "project_docker"
PROJECT_DOCKER_CACHE_ROOT = "/opt/robotick/project-target-cache"
BASE_IMAGE_BY_FAMILY = {
    "linux-x64": "ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
    "linux-arm64": "ghcr.io/robotick-labs/robotick-debian12-cross-linux-arm64:latest",
    "linux-arm32": "ghcr.io/robotick-labs/robotick-debian12-cross-linux-arm32:latest",
    "esp32": "ghcr.io/robotick-labs/robotick-idf5.4-esp32:latest",
}
ARM64_TARGET_VARIANTS = {"arm64", "aarch64"}
ARM32_TARGET_VARIANTS = {"arm32", "armhf", "armv7", "armv7hf"}


@dataclass(frozen=True)
class PreparedProjectDockerInfo:
    """Resolved local project-target image plus the files that produced it."""

    family: str
    image_name: str
    image_repo: str
    image_tag: str
    base_image: str
    metadata_path: Path
    dockerfile_path: Path
    context_dir: Path
    scoped_models: tuple[str, ...]


def _print_command(command: Iterable[str]) -> None:
    pretty = " ".join(shlex.quote(part) for part in command)
    print(f"[bold]$ {pretty}[/]")


def _project_safe(project: str) -> str:
    return project.replace("-", "_")


def _resolve_project_state_root(project: str, base_dir: Path) -> Path:
    project_file = base_dir / f"{project}.project.yaml"
    project_dir = project_file.parent.resolve()
    return project_dir / ".launcher" / _project_safe(project) / PROJECT_DOCKER_DIRNAME


def _normalize_linux_family(target_variant: str) -> str:
    if target_variant in ARM64_TARGET_VARIANTS:
        return "linux-arm64"
    if target_variant in ARM32_TARGET_VARIANTS:
        return "linux-arm32"
    return "linux-x64"


def _family_for_runtime(target_platform: str, target_variant: str) -> Optional[str]:
    platform = (target_platform or "").strip().lower()
    variant = (target_variant or "").strip().lower()
    if platform == "esp32":
        return "esp32"
    if platform == "linux":
        return _normalize_linux_family(variant)
    return None


def _family_for_model(project: str, model: str, target: str, base_dir: Path) -> Optional[str]:
    config = Config(project, model, target, base_dir, dry_run=False, stub_install=False)
    runtime = dict(config.model.get("runtime") or {})
    target_platform = str(runtime.get("target_platform") or target).strip().lower()
    target_variant = str(runtime.get("target_variant") or "").strip().lower()
    return _family_for_runtime(target_platform, target_variant)


def _image_repo_name(project: str, target: str) -> str:
    return f"robotick-{project}-{target}-docker"


def _family_state_dir(project: str, target: str, family: str, base_dir: Path) -> Path:
    return _resolve_project_state_root(project, base_dir) / target / family


def _family_metadata_path(project: str, target: str, family: str, base_dir: Path) -> Path:
    return _family_state_dir(project, target, family, base_dir) / "resolved-image.json"


def _docker_image_exists(image_name: str) -> bool:
    return (
        subprocess.run(
            ["docker", "image", "inspect", image_name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        ).returncode
        == 0
    )


def _ensure_base_image(base_image: str, *, dry_run: bool) -> None:
    if base_image.endswith(":latest"):
        command = ["docker", "pull", base_image]
        _print_command(command)
        if not dry_run:
            run_subprocess(command)
        return

    if _docker_image_exists(base_image):
        return

    command = ["docker", "pull", base_image]
    _print_command(command)
    if not dry_run:
        run_subprocess(command)


def _resolve_model_names(
    project: str,
    base_dir: Path,
    *,
    model: Optional[str],
    models: Optional[Iterable[str]],
) -> list[str]:
    if models:
        return list(dict.fromkeys(models))
    if model:
        return [model]

    project_file = base_dir / f"{project}.project.yaml"
    resolved: list[str] = []
    for rel in list_project_models(str(project_file)):
        name = Path(rel).stem
        if name.endswith(".model"):
            name = name.removesuffix(".model")
        resolved.append(name)
    return resolved


def _merge_dependency_tree(source: Path, dest: Path) -> None:
    if not source.exists():
        return
    dest.mkdir(parents=True, exist_ok=True)
    for child in source.iterdir():
        target = dest / child.name
        if target.exists():
            continue
        if child.is_dir():
            shutil.copytree(child, target)
        else:
            shutil.copy2(child, target)


def _collect_materialized_dependencies(
    project: str,
    base_dir: Path,
    target: str,
    scoped_models: list[str],
    family_context_dir: Path,
    *,
    dry_run: bool,
    stub_install: bool,
) -> tuple[list[str], list[dict[str, object]], list[dict[str, object]]]:
    """Sync image-level model deps into a merged cache for one target family.

    Each scoped model is synced into its own temporary launcher folder first so
    that existing dependency resolution code can keep running unchanged. We then
    merge only the materialised outputs that are meant to become part of the
    derived image:

    - deps/: third-party sources and archives the build should see in-container
    - components/: ESP-IDF style components that the build scripts expect

    The merged cache is copied into /opt/robotick/project-target-cache inside
    the image and later materialised back into the bind-mounted launcher dir at
    build time.
    """

    apt_packages: set[str] = set()
    installed_deps: list[dict[str, object]] = []
    model_entries: list[dict[str, object]] = []
    staged_root = family_context_dir / "model-cache"
    staged_root.mkdir(parents=True, exist_ok=True)
    merged_cache = family_context_dir / "cache"
    deps_cache = merged_cache / "deps"
    components_cache = merged_cache / "components"

    for model_name in scoped_models:
        model_config = Config(project, model_name, target, base_dir, dry_run, stub_install)
        model_launcher_dir = staged_root / model_name.replace("-", "_")
        model_launcher_dir.mkdir(parents=True, exist_ok=True)
        model_config.launcher_dir = model_launcher_dir

        deps, apt = sync_model_dependencies(model_config)
        apt_packages.update(apt)
        model_entries.append(
            {
                "model": model_name,
                "target": target,
                "target_family": _family_for_model(project, model_name, target, base_dir),
            }
        )
        for dep_name, source_ref, pin, dest_path in deps:
            installed_deps.append(
                {
                    "model": model_name,
                    "name": dep_name,
                    "source": source_ref,
                    "pin": pin,
                    "dest": str(dest_path.relative_to(model_launcher_dir)),
                }
            )

        _merge_dependency_tree(model_launcher_dir / "deps", deps_cache)
        _merge_dependency_tree(model_launcher_dir / "components", components_cache)

    merged_cache.mkdir(parents=True, exist_ok=True)
    (merged_cache / ".keep").write_text("project-target-cache\n", encoding="utf-8")
    return sorted(apt_packages), installed_deps, model_entries


def _render_dockerfile(base_image: str, apt_packages: list[str], include_cache: bool) -> str:
    """Render the small derived Dockerfile for a project-target image.

    The generated Dockerfile is intentionally minimal: start from the shared
    base image, add any extra apt packages declared by the scoped models, and
    copy in the merged dependency cache if one exists.
    """

    lines = [f"FROM {base_image}", ""]
    if apt_packages:
        lines.extend(
            [
                "ENV DEBIAN_FRONTEND=noninteractive",
                "",
                "RUN apt-get update \\",
                "    && apt-get install -y --no-install-recommends \\",
            ]
        )
        for package in apt_packages:
            lines.append(f"        {package} \\")
        lines.append("    && rm -rf /var/lib/apt/lists/*")
        lines.append("")
    if include_cache:
        lines.append(f"COPY cache/ {PROJECT_DOCKER_CACHE_ROOT}/")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _write_project_docker_context(
    family_context_dir: Path,
    *,
    dockerfile_contents: str,
    metadata: dict[str, object],
) -> tuple[Path, Path]:
    family_context_dir.mkdir(parents=True, exist_ok=True)
    dockerfile_path = family_context_dir / "Dockerfile"
    metadata_path = family_context_dir / "metadata.json"
    write_text_if_changed(dockerfile_path, dockerfile_contents)
    write_text_if_changed(metadata_path, json.dumps(metadata, indent=2) + "\n")
    return dockerfile_path, metadata_path


def _image_tag_for_metadata(family: str, metadata: dict[str, object]) -> str:
    """Derive a stable local tag from the image-relevant metadata.

    We tag by a short hash of the resolved dependency payload so that the same
    project-target dependency set reuses the same local image, while a real
    dependency change naturally produces a new tag.
    """

    payload = json.dumps(metadata, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()[:16]
    return f"{family}-{digest}"


def prepare_project_docker(
    project: str,
    base_dir: Path,
    *,
    target: str = "linux",
    model: Optional[str] = None,
    models: Optional[Iterable[str]] = None,
    dry_run: bool = False,
    stub_install: bool = False,
) -> Optional[PreparedProjectDockerInfo]:
    """Resolve the local derived image for one project/target family.

    This stage is deliberately family-scoped. A single call may prepare several
    models, but only when they all resolve to the same target family such as
    linux-x64, linux-arm64, linux-arm32, or esp32. That keeps each derived
    image aligned with one concrete toolchain contract.
    """

    base_dir = base_dir.resolve()
    scoped_models = _resolve_model_names(project, base_dir, model=model, models=models)
    if not scoped_models:
        return None

    families = {
        family
        for family in (
            _family_for_model(project, model_name, target, base_dir)
            for model_name in scoped_models
        )
        if family is not None
    }
    if not families:
        return None
    if len(families) != 1:
        raise ValueError(
            "prepare-project-docker requires models from a single target family per call."
        )

    family = next(iter(families))
    base_image = BASE_IMAGE_BY_FAMILY[family]
    state_dir = _family_state_dir(project, target, family, base_dir)
    state_dir.mkdir(parents=True, exist_ok=True)

    apt_packages, installed_deps, model_entries = _collect_materialized_dependencies(
        project,
        base_dir,
        target,
        scoped_models,
        state_dir,
        dry_run=dry_run,
        stub_install=stub_install,
    )

    include_cache = (state_dir / "cache").exists()
    # This payload is both the human-readable record of what went into the
    # derived image and the input to the content-derived tag hash below.
    metadata_payload: dict[str, object] = {
        "project": project,
        "target": target,
        "family": family,
        "base_image": base_image,
        "models": model_entries,
        "apt_packages": apt_packages,
        "installed_dependencies": installed_deps,
    }
    image_repo = _image_repo_name(project, target)
    image_tag = _image_tag_for_metadata(family, metadata_payload)
    image_name = f"{image_repo}:{image_tag}"
    metadata_payload["image_name"] = image_name

    dockerfile_contents = _render_dockerfile(base_image, apt_packages, include_cache)
    dockerfile_path, context_metadata_path = _write_project_docker_context(
        state_dir,
        dockerfile_contents=dockerfile_contents,
        metadata=metadata_payload,
    )

    resolved_metadata_path = _family_metadata_path(project, target, family, base_dir)
    # The resolved metadata is what downstream launcher stages look up when they
    # want to reuse the already-prepared local project-target image.
    resolved_payload = {
        "family": family,
        "image_name": image_name,
        "image_repo": image_repo,
        "image_tag": image_tag,
        "base_image": base_image,
        "dockerfile_path": str(dockerfile_path),
        "context_dir": str(state_dir),
        "scoped_models": scoped_models,
        "metadata_path": str(context_metadata_path),
    }
    write_text_if_changed(resolved_metadata_path, json.dumps(resolved_payload, indent=2) + "\n")

    if dry_run:
        print(f"[yellow]DRY RUN:[/] would prepare project docker image {image_name}")
        return PreparedProjectDockerInfo(
            family=family,
            image_name=image_name,
            image_repo=image_repo,
            image_tag=image_tag,
            base_image=base_image,
            metadata_path=resolved_metadata_path,
            dockerfile_path=dockerfile_path,
            context_dir=state_dir,
            scoped_models=tuple(scoped_models),
        )

    if _docker_image_exists(image_name):
        return PreparedProjectDockerInfo(
            family=family,
            image_name=image_name,
            image_repo=image_repo,
            image_tag=image_tag,
            base_image=base_image,
            metadata_path=resolved_metadata_path,
            dockerfile_path=dockerfile_path,
            context_dir=state_dir,
            scoped_models=tuple(scoped_models),
        )

    _ensure_base_image(base_image, dry_run=dry_run)
    build_cmd = ["docker", "build", "-t", image_name, str(state_dir)]
    _print_command(build_cmd)
    run_subprocess(build_cmd)
    return PreparedProjectDockerInfo(
        family=family,
        image_name=image_name,
        image_repo=image_repo,
        image_tag=image_tag,
        base_image=base_image,
        metadata_path=resolved_metadata_path,
        dockerfile_path=dockerfile_path,
        context_dir=state_dir,
        scoped_models=tuple(scoped_models),
    )


def load_prepared_project_docker_info(
    project: str,
    model: str,
    target: str,
    base_dir: Path,
) -> Optional[PreparedProjectDockerInfo]:
    """Load the latest resolved local image for the model's target family."""

    family = _family_for_model(project, model, target, base_dir)
    if family is None:
        return None
    metadata_path = _family_metadata_path(project, target, family, base_dir)
    if not metadata_path.exists():
        return None
    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    image_name = payload.get("image_name")
    if not isinstance(image_name, str) or not image_name:
        return None

    return PreparedProjectDockerInfo(
        family=family,
        image_name=image_name,
        image_repo=str(payload.get("image_repo") or image_name.split(":", 1)[0]),
        image_tag=str(payload.get("image_tag") or image_name.split(":", 1)[-1]),
        base_image=str(payload.get("base_image") or ""),
        metadata_path=metadata_path,
        dockerfile_path=Path(payload.get("dockerfile_path") or metadata_path),
        context_dir=Path(payload.get("context_dir") or metadata_path.parent),
        scoped_models=tuple(payload.get("scoped_models") or []),
    )


def project_cache_materialize_shell(
    launcher_dir: str,
    *,
    subdir: str,
) -> str:
    """Return a shell fragment that copies cached image-side deps to launcher dir.

    The cache lives inside the derived image so it survives container reuse, but
    the actual build scripts still expect to work against files in the mounted
    launcher directory. Materialising the cache bridges those two worlds.
    """

    cache_dir = f"{PROJECT_DOCKER_CACHE_ROOT}/{subdir}"
    launcher_cache_dir = f"{launcher_dir}/{subdir}"
    return (
        f"if [[ -d {cache_dir} ]]; then "
        f"mkdir -p {launcher_cache_dir} && "
        f"cp -a {cache_dir}/. {launcher_cache_dir}/; "
        "fi"
    )
