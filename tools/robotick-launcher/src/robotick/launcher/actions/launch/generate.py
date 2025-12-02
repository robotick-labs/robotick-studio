from pathlib import Path
from typing import Optional

from rich import print
import shutil
import typer
import traceback
from typer.models import OptionInfo

from robotick.launcher.config import Config
from robotick.launcher.utils import copy_extras_for_target
from robotick.launcher.actions.launch import (
    generate_main_cpp,
    generate_model_cpp,
    generate_cmake,
    generate_workloads_registry,
    generate_do_install_deps,
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
):
    """
    Generate the .launcher folder structure and files for the given project/model/target.
    """

    try:
        if isinstance(workspace_dir, OptionInfo):
            workspace_dir = None

        base_dir = base_dir.resolve()
        workspace_root = (workspace_dir or base_dir).resolve()
        config = Config(project, model, target, base_dir, dry_run, stub_install)

        if config.python_roots:
            install_deps_stage.install_deps(
                project=project,
                base_dir=base_dir,
                workspace_root=workspace_root,
                dry_run=dry_run,
                stub_install=stub_install,
            )

        print("============================================================================================")
        print(
            f"[bold green]📦 Generating {project}-{model}-{target}[/] (dry_run={dry_run}, stub_install={config.stub_install})"
        )

        # placeholder code for per-target overrides (needs to move to a yaml ideally)
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
        generate_main_cpp.generate_main_cpp(config)
        generate_model_cpp.generate_model_cpp(config)
        generate_workloads_registry.generate_workloads_registry(config)
        generate_cmake.generate_project_cmakelists(config)
        generate_cmake.generate_component_cmakelists(config)

        generate_do_install_deps.generate_do_install_deps(config)

        print(f"[bold green]✅ Generating complete!")

    except Exception as e:  # pragma: no cover - Typer handles surfacing this
        print(
            f"[bold red]❌ Generation failed with error:[/] {type(e).__name__}: {e}"
        )
        traceback.print_exc()
        raise typer.Exit(code=1)
