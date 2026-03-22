from pathlib import Path
import logging
import os
from rich import print
from robotick.launcher.utils import render_template, write_text_if_changed
from robotick.launcher.actions.launch.generate_workloads_registry import (
    _collect_platform_files,
)


logger = logging.getLogger(__name__)

def _cmake_relpath(target: Path, start: Path) -> str:
    """Return POSIX-style relative path for CMake, or absolute if not relative-able."""
    try:
        rel = os.path.relpath(target.resolve(), start.resolve())
        return Path(rel).as_posix()
    except ValueError:
        return target.resolve().as_posix()


def _resolve_platform_extra_cpp_paths(config, workload_roots_abs, start_dir: Path) -> list[str]:
    used_types = {w["type"] for w in (config.model.get("workloads", []) or [])}
    platform_extra_cpp = _collect_platform_files(config, used_types)
    resolved_paths: list[str] = []

    for rel_path in platform_extra_cpp:
        resolved_abs = None
        for root in workload_roots_abs:
            candidate = (root / Path(rel_path)).resolve()
            if candidate.exists():
                resolved_abs = candidate
                break

        if resolved_abs is None:
            raise RuntimeError(
                f"Could not resolve platform extra source '{rel_path}' from configured workload roots."
            )

        resolved_paths.append(_cmake_relpath(resolved_abs, start_dir))

    return resolved_paths

def generate_project_cmakelists(config) -> None:
    """Render and write .launcher/CMakeLists.txt for the given (project, model, target).
    Expects config.{base_dir, launcher_dir, model_name, model_name_safe, target, dry_run}
    and config.runtime.{engine, workloads}.
    """

    # Set platform macros based on target
    platform = getattr(config, "target", "linux")
    platform_macros = []
    target_variant = str(
        ((getattr(config, "model", {}) or {}).get("runtime") or {}).get("target_variant")
        or ""
    ).strip().lower()
    if platform.lower() == "linux":
        platform_macros.append("ROBOTICK_PLATFORM_DESKTOP")
        platform_macros.append("ROBOTICK_PLATFORM_LINUX")
    elif platform.lower() == "esp32":
        platform_macros.append("ROBOTICK_PLATFORM_ESP32")
        platform_macros.append("ROBOTICK_PLATFORM_ESP32S3")
        if target_variant == "esp32s3_m5":
            platform_macros.append("ROBOTICK_PLATFORM_ESP32S3_M5")

    filename = "CMakeLists.txt"
    path = config.launcher_dir / filename
    cmakelists_dir = path.parent

    # Compute relative paths to use in CMake template
    runtime_cfg = getattr(config, "runtime", {})
    engine_entry = runtime_cfg.get("engine") or {}
    engine_path = (
        engine_entry.get("local_path")
        or engine_entry.get("path_override")
        or engine_entry.get("path")
    )
    if engine_path:
        robotick_engine_root_abs = config.resolve_project_path(engine_path)
    else:
        raise RuntimeError("Engine repo/path not specified in runtime section.")

    workload_entries = runtime_cfg.get("workload_sources") or []
    workload_roots_abs = []
    for idx, entry in enumerate(workload_entries):
        base = entry.get("local_path") or entry.get("path_override")
        if not base:
            logger.debug(
                "Skipping workload entry without local_path/path_override at index %s: %s",
                idx,
                entry,
            )
            continue
        base_abs = config.resolve_project_path(base)
        root_paths = entry.get("root_paths") or []
        if root_paths:
            for rel in root_paths:
                workload_roots_abs.append((base_abs / Path(rel)).resolve())
        else:
            workload_roots_abs.append(base_abs)
    if not workload_roots_abs:
        raise RuntimeError("No workload_sources configured with local_path/path_override entries.")

    robotick_engine_root_rel = _cmake_relpath(robotick_engine_root_abs, cmakelists_dir)
    workload_roots_rel = [
        _cmake_relpath(root, cmakelists_dir) for root in workload_roots_abs
    ]
    platform_extra_cpp = _resolve_platform_extra_cpp_paths(
        config, workload_roots_abs, cmakelists_dir
    )

    # ✏️ Template parameters — override with CLI args or config later
    context = {
        "model_name": config.model_name,
        "model_name_safe": config.model_name_safe,
        "platform": platform,
        "robotick_engine_root": robotick_engine_root_rel,
        "workload_roots": workload_roots_rel,
        "platform_macros": platform_macros,
        "platform_extra_cpp": platform_extra_cpp,
    }

    try:
        template_file_name = f"CMakeLists_project_{platform}.txt"
        contents = render_template(template_file_name, context)
    except FileNotFoundError as e:
        print(f"[bold red]❌ {e}[/]")
        return
    except Exception as e:
        print(f"[bold red]❌ Failed to render CMakeLists (project) template[/]")
        print(f"[red]Reason:[/] {e}")
        return

    if config.dry_run:
        print(f"[yellow]📝 Dry run — would create main CMake (project) file:[/] {path}")
        return

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not write_text_if_changed(path, contents):
            raise RuntimeError(f"Failed to write {path}")
    except OSError as e:
        print(f"[bold red]❌ Failed to write file:[/] {path}")
        print(f"[red]Reason:[/] {e}")
        raise


def generate_component_cmakelists(config) -> None:
    """Render and write .launcher/<config.subdir_component_cmakelists>/CMakeLists.txt for the given (project, model, target).
    Expects config.{base_dir, launcher_dir, model_name, model_name_safe, target, dry_run}
    and config.runtime.{engine, workloads}.
    """
    subdir = getattr(config, "subdir_component_cmakelists", "")

    if not config.should_generate_component_cmakelists or subdir.strip() == "":
        return

    # Set platform macros based on target
    platform = getattr(config, "target", "linux")
    platform_macros = []
    target_variant = str(
        ((getattr(config, "model", {}) or {}).get("runtime") or {}).get("target_variant")
        or ""
    ).strip().lower()
    if platform.lower() == "linux":
        platform_macros.append("ROBOTICK_PLATFORM_DESKTOP")
        platform_macros.append("ROBOTICK_PLATFORM_LINUX")
    elif platform.lower() == "esp32":
        platform_macros.append("ROBOTICK_PLATFORM_ESP32")
        platform_macros.append("ROBOTICK_PLATFORM_ESP32S3")
        if target_variant == "esp32s3_m5":
            platform_macros.append("ROBOTICK_PLATFORM_ESP32S3_M5")

    filename = "CMakeLists.txt"
    path = config.launcher_dir / subdir / filename
    cmakelists_dir = path.parent

    # Compute relative paths to use in CMake template
    runtime_cfg = getattr(config, "runtime", {})
    engine_entry = runtime_cfg.get("engine") or {}
    engine_path = (
        engine_entry.get("local_path")
        or engine_entry.get("path_override")
        or engine_entry.get("path")
    )
    if engine_path:
        robotick_engine_root_abs = config.resolve_project_path(engine_path)
    else:
        raise RuntimeError("Engine repo/path not specified in runtime section.")

    workload_entries = runtime_cfg.get("workload_sources") or []
    workload_roots_abs = []
    for idx, entry in enumerate(workload_entries):
        base = entry.get("local_path") or entry.get("path_override")
        if not base:
            logger.debug(
                "Skipping workload entry without local_path/path_override at index %s: %s",
                idx,
                entry,
            )
            continue
        base_abs = config.resolve_project_path(base)
        root_paths = entry.get("root_paths") or []
        if root_paths:
            for rel in root_paths:
                workload_roots_abs.append((base_abs / Path(rel)).resolve())
        else:
            workload_roots_abs.append(base_abs)
    if not workload_roots_abs:
        raise RuntimeError("No workload_sources configured with local_path/path_override entries.")

    robotick_engine_root_rel = _cmake_relpath(robotick_engine_root_abs, cmakelists_dir)
    workload_roots_rel = [
        _cmake_relpath(root, cmakelists_dir) for root in workload_roots_abs
    ]
    platform_extra_cpp = _resolve_platform_extra_cpp_paths(
        config, workload_roots_abs, cmakelists_dir
    )

    # ✏️ Template parameters — override with CLI args or config later
    context = {
        "model_name": config.model_name,
        "model_name_safe": config.model_name_safe,
        "platform": platform,
        "robotick_engine_root": robotick_engine_root_rel,
        "workload_roots": workload_roots_rel,
        "platform_macros": platform_macros,
        "platform_extra_cpp": platform_extra_cpp,
    }

    try:
        template_file_name = f"CMakeLists_component_{platform}.txt"
        contents = render_template(template_file_name, context)
    except FileNotFoundError as e:
        print(f"[bold red]❌ {e}[/]")
        return
    except Exception as e:
        print(f"[bold red]❌ Failed to render CMakeLists (component) template[/]")
        print(f"[red]Reason:[/] {e}")
        return

    if config.dry_run:
        print(f"[yellow]📝 Dry run — would create main CMake (component) file:[/] {path}")
        return

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not write_text_if_changed(path, contents):
            raise RuntimeError(f"Failed to write {path}")
    except OSError as e:
        print(f"[bold red]❌ Failed to write file:[/] {path}")
        print(f"[red]Reason:[/] {e}")
        raise
