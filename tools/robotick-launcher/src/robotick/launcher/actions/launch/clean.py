from pathlib import Path
import shutil
from typing import Optional
from rich import print
import typer

from robotick.launcher.runtime_lock import RUNTIME_LOCK_FILENAME
from robotick.launcher.actions.launch.project_workspace_hydration import (
    LOCK_FILENAME as PYTHON_LOCK_FILENAME,
)
from robotick.launcher.utils import get_launcher_paths

INSTALL_LOCK_FILENAME = ".install.lock"

clean_app = typer.Typer(
    name="clean",
    help="Clean generated artefacts or dependency caches (see subcommands)",
)


def _delete_path(path: Path, dry_run: bool, label: str) -> None:
    if not path.exists():
        print(f"[yellow]⚠️ {label} does not exist anyway:[/] {path}")
        return
    action = (
        "[yellow]🧹 Dry run — would delete:[/]" if dry_run else "[green]🧹 Deleting:[/]"
    )
    print(f"{action} {path}")
    if dry_run:
        return
    shutil.rmtree(path, ignore_errors=True)
    print(f"[bold green]✅ Removed {label}.[/]")


def _remove_file(path: Path, dry_run: bool, label: str) -> None:
    if not path.exists():
        return
    if dry_run:
        print(f"[yellow]🧹 Dry run — would remove {label}:[/] {path}")
        return
    try:
        path.unlink()
        print(f"[green]🧹 Removed {label}:[/] {path}")
    except OSError as exc:
        print(f"[yellow]⚠️ Failed to remove {label} ({exc})[/]")


@clean_app.command(
    "generated",
    help="Delete the generated launcher folder (.launcher/<project>/generated/<model>/<target>)",
)
def clean_generated(
    project: str = typer.Argument(..., help="Project name (e.g. 'pip-e')"),
    model: str = typer.Argument(..., help="Model name (e.g. 'pip-e-brain')"),
    target: str = typer.Argument(..., help="Target name (e.g. 'linux')"),
    base_dir: Path = typer.Option(
        Path.cwd(), help="Base directory containing the project/.launcher"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Show what would be deleted without deleting"
    ),
):
    launcher_dir, _, _ = get_launcher_paths(project, model, target, base_dir)
    _delete_path(launcher_dir, dry_run, "launcher folder")


def _runtime_paths(
    project: str, target: str, base_dir: Path
) -> tuple[Path, Path, Path, Path]:
    """Return (runtime_target, runtime_lock, install_lock, python_lock)."""
    project_safe = project.replace("-", "_")
    target_safe = target.replace("-", "_")
    runtime_root = (
        base_dir / ".launcher" / project_safe / "deps" / "runtime"
    ).resolve()
    runtime_target = (runtime_root / target_safe).resolve()
    python_lock = (
        base_dir / ".launcher" / project_safe / "deps" / "python" / PYTHON_LOCK_FILENAME
    ).resolve()
    runtime_lock = (runtime_root / RUNTIME_LOCK_FILENAME).resolve()
    install_lock = (runtime_root / INSTALL_LOCK_FILENAME).resolve()
    return runtime_target, runtime_lock, install_lock, python_lock


@clean_app.command(
    "deps",
    help="Delete runtime dependency checkout (.launcher/<project>/deps/runtime/<target>)",
)
def clean_deps(
    project: str = typer.Argument(..., help="Project name (e.g. 'pip-e')"),
    target: str = typer.Argument(..., help="Target name (e.g. 'linux')"),
    model: Optional[str] = typer.Option(
        None,
        "--model",
        "-m",
        help="Model name (e.g. 'pip-e-brain') — required when --clean-generated is used",
    ),
    base_dir: Path = typer.Option(
        Path.cwd(), help="Base directory containing the project/.launcher"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Show what would be deleted without deleting"
    ),
    clean_generated_artifacts: bool = typer.Option(
        False,
        "--clean-generated/--no-clean-generated",
        help="Also delete generated launcher artefacts for this model/target",
    ),
):
    runtime_target, _, _, _ = _runtime_paths(project, target, base_dir)
    _delete_path(runtime_target, dry_run, "runtime dependency folder")
    if clean_generated_artifacts:
        if not model:
            raise typer.BadParameter(
                "MODEL argument is required when --clean-generated is set",
                param_hint="MODEL",
            )
        clean_generated(project, model, target, base_dir, dry_run)


@clean_app.command(
    "all",
    help="Delete runtime deps, generated artefacts, and related lockfiles for a model/target",
)
def clean_all(
    project: str = typer.Argument(..., help="Project name (e.g. 'pip-e')"),
    model: str = typer.Argument(..., help="Model name (e.g. 'pip-e-brain')"),
    target: str = typer.Argument(..., help="Target name (e.g. 'linux')"),
    base_dir: Path = typer.Option(
        Path.cwd(), help="Base directory containing the project/.launcher"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Show what would be deleted without deleting"
    ),
):
    clean_generated(project, model, target, base_dir, dry_run)
    runtime_target, runtime_lock, install_lock, python_lock = _runtime_paths(
        project, target, base_dir
    )
    _delete_path(runtime_target, dry_run, "runtime dependency folder")
    _remove_file(runtime_lock, dry_run, "runtime lockfile")
    _remove_file(install_lock, dry_run, "install lockfile")
    _remove_file(python_lock, dry_run, "python lockfile")
