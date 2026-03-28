from pathlib import Path
from typing import Optional

from rich import print
import typer
import traceback
from typer.models import OptionInfo

from robotick.launcher.config import Config
from robotick.launcher.utils import copy_extras_for_target, write_text_if_changed
from robotick.launcher.actions.launch import (
    generate_main_cpp,
    generate_model_cpp,
    generate_cmake,
    generate_workloads_registry,
    install_deps as install_deps_stage,
)

def _resolve_project_local_path(config: Config, raw_path: str) -> Path:
    value = str(raw_path).replace("${PROJECT_DIR}", str(config.project_dir))
    path = Path(value)
    if not path.is_absolute():
        path = config.base_dir / path
    return path.resolve()


def write_launcher_env_if_needed(config: Config) -> None:
    launcher_env = config.launcher_dir / "launcher.env"

    env_lines: list[str] = []
    runtime = dict((config.model or {}).get("runtime") or {})
    deploy = dict(runtime.get("deploy") or {})
    target_variant = str(runtime.get("target_variant") or "").strip().lower()

    if config.target == "esp32":
        env_lines.append("# Generated from model runtime metadata.")

        engine_local_path = str(
            dict((config.runtime or {}).get("engine") or {}).get("local_path") or ""
        ).strip()
        if engine_local_path:
            engine_root = _resolve_project_local_path(config, engine_local_path)
            env_lines.append(f'export ROBOTICK_ENGINE_PATH="{engine_root}"')

        serial_port = str(deploy.get("serial_port") or "").strip()
        if serial_port:
            env_lines.append(
                f'export ROBOTICK_ESP32_SERIAL_PORT="{serial_port}"'
            )

        if target_variant == "esp32s3_m5":
            env_lines.append("export ROBOTICK_PLATFORM_ESP32S3_M5=1")
            env_lines.append(
                'export IDF_EXTRA_CMAKE_ARGS="-DROBOTICK_PLATFORM_ESP32S3=ON -DROBOTICK_PLATFORM_ESP32S3_M5=ON"'
            )

    if env_lines:
        contents = "\n".join(env_lines) + "\n"
        if config.dry_run:
            print(f"[grey]📝 Dry run — would write launcher env:[/] {launcher_env}")
        else:
            write_text_if_changed(launcher_env, contents)
        return

    if launcher_env.exists():
        if config.dry_run:
            print(f"[grey]📝 Would remove stale file:[/] {launcher_env}")
        else:
            launcher_env.unlink()
            print(f"[cyan]📝 Removed stale file:[/] {launcher_env}")


def generate(
    project: str = typer.Argument(..., help="Project name (e.g. 'my_robot')"),
    model: str = typer.Argument(..., help="Model name (e.g. 'my_robot_brain')"),
    target: str = typer.Argument(..., help="Target name (e.g. 'linux')"),
    base_dir: Path = typer.Option(
        Path.cwd(), help="Base directory to create .launcher folder under"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Show what would be created without creating it"
    ),
    stub_install: bool = typer.Option(
        False,
        "--stub-install",
        help="Only create target-folder for each installed dependency, not full install",
    ),
    workspace_dir: Optional[Path] = typer.Option(
        None, help="Workspace root containing the .launcher folder"
    ),
    skip_install_deps: bool = False,
):
    """
    Generate the .launcher folder structure and files for the given project/model/target.
    """

    try:
        if isinstance(workspace_dir, OptionInfo):
            workspace_dir = None

        base_dir = base_dir.resolve()
        workspace_root = (workspace_dir or base_dir).resolve()
        if not skip_install_deps:
            install_deps_stage.install_deps(
                project=project,
                base_dir=base_dir,
                workspace_root=workspace_root,
                dry_run=dry_run,
                stub_install=stub_install,
                model=model,
                target=target,
            )

        config = Config(project, model, target, base_dir, dry_run, stub_install)
        target_variant = str(
            ((config.model or {}).get("runtime") or {}).get("target_variant") or ""
        ).strip()

        print("============================================================================================")
        print(
            f"[bold green]📦 Generating {project}-{model}-{target}[/] (dry_run={dry_run}, stub_install={config.stub_install})"
        )

        # ESP32 generation still uses a component-style layout that differs from linux builds.
        # Keep those file-placement overrides centralized here until target layout becomes fully declarative.
        if target == "esp32":
            config.subdir_main_cpp = "main"
            config.subdir_model_cpp = "main"
            config.subdir_registry = "main"
            config.should_generate_workload_deps = False
            config.should_generate_component_cmakelists = True
            config.subdir_component_cmakelists = "main"
        else:
            config.should_generate_workload_deps = True
            config.should_generate_component_cmakelists = False

        # Folder creation
        config.launcher_dir.mkdir(parents=True, exist_ok=True)
        print(f"[green]📂 Launcher folder:[/] {config.launcher_dir}")

        # File generation
        copy_extras_for_target(config, variant=target_variant)
        write_launcher_env_if_needed(config)
        generate_main_cpp.generate_main_cpp(config)
        generate_model_cpp.generate_model_cpp(config)
        generate_workloads_registry.generate_workloads_registry(config)
        generate_cmake.generate_project_cmakelists(config)
        generate_cmake.generate_component_cmakelists(config)

        print(f"[bold green]✅ Generating complete!")

    except Exception as e:  # pragma: no cover - Typer handles surfacing this
        print(
            f"[bold red]❌ Generation failed with error:[/] {type(e).__name__}: {e}"
        )
        traceback.print_exc()
        raise typer.Exit(code=1)
