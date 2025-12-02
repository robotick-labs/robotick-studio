from pathlib import Path
import os
from rich import print
from robotick.launcher.utils import render_template, write_text_if_changed

def _cmake_relpath(target: Path, start: Path) -> str:
    """Return POSIX-style relative path for CMake, or absolute if not relative-able."""
    try:
        rel = os.path.relpath(target.resolve(), start.resolve())
        return Path(rel).as_posix()
    except ValueError:
        return target.resolve().as_posix()

def generate_project_cmakelists(config) -> None:
    """Render and write .launcher/CMakeLists.txt for the given (project, model, target).
    Expects config.{base_dir, launcher_dir, model_name, model_name_safe, target, dry_run}
    and config.project.{robotick_engine_root, local_workload_roots}.
    """

    # Set platform macros based on target
    platform = getattr(config, "target", "linux")
    platform_macros = []
    if platform.lower() == "linux":
        platform_macros.append("ROBOTICK_PLATFORM_DESKTOP")
        platform_macros.append("ROBOTICK_PLATFORM_LINUX")
    elif platform.lower() == "esp32":
        platform_macros.append("ROBOTICK_PLATFORM_ESP32")

    filename = "CMakeLists.txt"
    path = config.launcher_dir / filename
    cmakelists_dir = path.parent

    # Compute relative paths to use in CMake template
    robotick_engine_root_abs = (config.base_dir / config.project.robotick_engine_root).resolve()
    workload_root_entries = (
        config.project.get("local_workload_roots")
        or config.project.get("workload_roots", [])
    )
    workload_roots_abs = [
        (config.base_dir / root).resolve() for root in workload_root_entries
    ]

    robotick_engine_root_rel = _cmake_relpath(robotick_engine_root_abs, cmakelists_dir)
    workload_roots_rel = [
        _cmake_relpath(root, cmakelists_dir) for root in workload_roots_abs
    ]

    # ✏️ Template parameters — override with CLI args or config later
    context = {
        "model_name": config.model_name,
        "model_name_safe": config.model_name_safe,
        "platform": platform,
        "robotick_engine_root": robotick_engine_root_rel,
        "workload_roots": workload_roots_rel,
        "platform_macros": platform_macros
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
        write_text_if_changed(path, contents)
    except OSError as e:
        print(f"[bold red]❌ Failed to write file:[/] {path}")
        print(f"[red]Reason:[/] {e}")
        raise


def generate_component_cmakelists(config) -> None:
    """Render and write .launcher/<config.subdir_component_cmakelists>/CMakeLists.txt for the given (project, model, target).
    Expects config.{base_dir, launcher_dir, model_name, model_name_safe, target, dry_run}
    and config.project.{robotick_engine_root, local_workload_roots}.
    """
    subdir = getattr(config, "subdir_component_cmakelists", "")

    if not config.should_generate_component_cmakelists or subdir.strip() == "":
        return

    # Set platform macros based on target
    platform = getattr(config, "target", "linux")
    platform_macros = []
    if platform.lower() == "linux":
        platform_macros.append("ROBOTICK_PLATFORM_DESKTOP")
        platform_macros.append("ROBOTICK_PLATFORM_LINUX")
    elif platform.lower() == "esp32":
        platform_macros.append("ROBOTICK_PLATFORM_ESP32")

    filename = "CMakeLists.txt"
    path = config.launcher_dir / subdir / filename
    cmakelists_dir = path.parent

    # Compute relative paths to use in CMake template
    robotick_engine_root_abs = (config.base_dir / config.project.robotick_engine_root).resolve()
    workload_root_entries = (
        config.project.get("local_workload_roots")
        or config.project.get("workload_roots", [])
    )
    workload_roots_abs = [
        (config.base_dir / root).resolve() for root in workload_root_entries
    ]

    robotick_engine_root_rel = _cmake_relpath(robotick_engine_root_abs, cmakelists_dir)
    workload_roots_rel = [
        _cmake_relpath(root, cmakelists_dir) for root in workload_roots_abs
    ]

    # ✏️ Template parameters — override with CLI args or config later
    context = {
        "model_name": config.model_name,
        "model_name_safe": config.model_name_safe,
        "platform": platform,
        "robotick_engine_root": robotick_engine_root_rel,
        "workload_roots": workload_roots_rel,
        "platform_macros": platform_macros
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
        write_text_if_changed(path, contents)
    except OSError as e:
        print(f"[bold red]❌ Failed to write file:[/] {path}")
        print(f"[red]Reason:[/] {e}")
        raise
