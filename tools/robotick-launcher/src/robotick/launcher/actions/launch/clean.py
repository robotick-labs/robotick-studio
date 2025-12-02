from pathlib import Path
import shutil
from rich import print
import typer

from robotick.launcher.utils import get_launcher_paths, LAUNCHER_FOLDER

clean_app = typer.Typer(
    name="clean",
    help="Clean build folders or full generated launcher output (see subcommands)"
)

@clean_app.command("build", help="Delete only the CMake build/ folder for a specific project/model/target")
def clean_build(
    project: str = typer.Argument(..., help="Project name (e.g. 'barr_e')"),
    model: str = typer.Argument(..., help="Model name (e.g. 'barr_e_brain')"),
    target: str = typer.Argument(..., help="Target name (e.g. 'linux')"),
    base_dir: Path = typer.Option(Path.cwd(), help="Base directory containing .launcher"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Show what would be deleted without deleting")
):
    _, build_dir, _ = get_launcher_paths(project, model, target, base_dir)

    action = "[yellow]🧹 Dry run — would delete build folder:[/]" if dry_run else "[green]🧹 Deleting build folder:[/]"
    print(f"{action} {build_dir}")

    if not build_dir.exists():
        print(f"[yellow]⚠️ Build folder does not exist anyway:[/] {build_dir}")
        return

    if not dry_run:
        shutil.rmtree(build_dir, ignore_errors=True)

    print("[bold green]✅ Cleaned build folder.[/]")


@clean_app.command("all", help="Delete the full generated launcher folder for a specific project/model/target")
def clean_all(
    project: str = typer.Argument(..., help="Project name (e.g. 'barr_e')"),
    model: str = typer.Argument(..., help="Model name (e.g. 'barr_e_brain')"),
    target: str = typer.Argument(..., help="Target name (e.g. 'linux')"),
    base_dir: Path = typer.Option(Path.cwd(), help="Base directory containing .launcher"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Show what would be deleted without deleting")
):
    project_safe = project.replace("-", "_")
    model_safe = model.replace("-", "_")
    target_safe = target.replace("-", "_")

    launcher_dir = base_dir / LAUNCHER_FOLDER / project_safe / model_safe / target_safe

    action = "[yellow]🧹 Dry run — would delete launcher folder:[/]" if dry_run else "[green]🧹 Deleting launcher folder:[/]"
    print(f"{action} {launcher_dir}")

    if not launcher_dir.exists():
        print(f"[yellow]⚠️ Launcher folder does not exist anyway:[/] {launcher_dir}")
        return

    if not dry_run:
        shutil.rmtree(launcher_dir, ignore_errors=True)

    print("[bold green]✅ Cleaned launcher folder.[/]")
