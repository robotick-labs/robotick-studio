from pathlib import Path
from typing import Optional

from rich import print
import shutil
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


def copy_extras_if_exists(templates_dir: Path, target_dir: Path, target: str):
    """
    Copy all files (recursively) from templates/extras_<target>/ into target_dir.
    Existing files are overwritten. Skips if extras folder doesn't exist.
    """
    extras_dir = templates_dir / f"extras_{target}"
    if not extras_dir.exists() or not extras_dir.is_dir():
        print(f"ℹ️ No extras for target '{target}' (looked in {extras_dir})")
        return

    print(f"📦 Copying extras for '{target}' from {extras_dir} → {target_dir}")
    for src in extras_dir.rglob("*"):
        if src.is_file():
            rel_path = src.relative_to(extras_dir)
            dest_path = target_dir / rel_path
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest_path)  # preserve metadata
            print(f"  ✅ {rel_path}")


def copy_extras_if_exists_for_variant(
    templates_dir: Path, target_dir: Path, target: str, variant: str | None
):
    variant = (variant or "").strip().lower()
    if not variant:
        return
    extras_dir = templates_dir / f"extras_{target}_{variant}"
    if not extras_dir.exists() or not extras_dir.is_dir():
        return

    print(
        f"📦 Copying variant extras for '{target}/{variant}' from {extras_dir} → {target_dir}"
    )
    for src in extras_dir.rglob("*"):
        if src.is_file():
            rel_path = src.relative_to(extras_dir)
            dest_path = target_dir / rel_path
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest_path)
            print(f"  ✅ {rel_path}")


def write_launcher_env_if_needed(config: Config) -> None:
    launcher_env = config.launcher_dir / "launcher.env"

    env_lines: list[str] = []
    runtime = dict((config.model or {}).get("runtime") or {})
    deploy = dict(runtime.get("deploy") or {})
    target_variant = str(runtime.get("target_variant") or "").strip().lower()

    if config.target == "esp32":
        env_lines.append("# Generated from model runtime metadata.")

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
        copy_extras_for_target(config)
        # Variant extras overlay the base target files, so linux/arm64 and esp32 board-specific
        # templates can replace the generic target scripts without forking the full template set.
        copy_extras_if_exists_for_variant(
            Path(__file__).parent / "templates",
            config.launcher_dir,
            target,
            target_variant,
        )
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
