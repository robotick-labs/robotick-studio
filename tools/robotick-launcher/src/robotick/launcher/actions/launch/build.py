from pathlib import Path
import subprocess
from rich import print
import typer

from robotick.launcher.actions.launch.target_plan import (
    resolve_target_plan,
)
from robotick.launcher.actions.launch.custom_stages import (
    has_custom_stage_script,
)
from robotick.launcher.actions.launch.stages import LaunchStage
from robotick.launcher.utils import get_launcher_paths, run_subprocess


def build(
    project: str = typer.Argument(..., help="Project name (e.g. 'demo_robot')"),
    model: str = typer.Argument(..., help="Model name (e.g. 'demo_robot_brain')"),
    target: str = typer.Argument(..., help="Target name (e.g. 'linux')"),
    base_dir: Path = typer.Option(
        Path.cwd(), help="Base directory containing .launcher (default: cwd)"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Print commands without executing them"
    ),
):
    launcher_dir, build_dir, binary_path = get_launcher_paths(
        project, model, target, base_dir
    )
    plan = resolve_target_plan(project, model, target, base_dir)

    print(
        "============================================================================================"
    )
    print(f"[bold green]📦 Building {project}-{model}-{target}[/] (dry_run={dry_run})")

    do_build_cmd = ["bash", f"{launcher_dir}/do_launcher_build.sh"]

    print(f"[cyan]📁 Launcher dir:[/] {launcher_dir}")
    print(f"[cyan]🔧 Build dir:   [/] {build_dir}")
    print(f"[cyan]🚀 Binary path: [/] {binary_path}")
    print(f"[cyan]🧭 Build strategy:[/] {plan.build.strategy}")
    plan.build.print_summary()
    print()

    if plan.build.build_handler is not None:
        try:
            plan.build.build_handler(dry_run)
        except subprocess.CalledProcessError as e:
            print(f"[bold red]❌ Build process failed during: {e.cmd}[/]")
            raise typer.Exit(code=e.returncode)
        if dry_run:
            print("[yellow]⚠️ Dry run only — commands not executed.[/]")
            return
        expected_binary = plan.build.local_binary_path
        if (
            expected_binary is not None
            and not expected_binary.exists()
            and not has_custom_stage_script(launcher_dir, LaunchStage.BUILD)
        ):
            print(f"[bold red]❌ Expected binary not found:[/] {expected_binary}")
            raise typer.Exit(code=1)
        if expected_binary is not None and not expected_binary.exists():
            print("[bold green]✅ Build complete! Custom build stage owns its output.[/]")
            return
        built_binary = plan.build.display_binary_path or str(binary_path)
        print(f"[bold green]✅ Build complete! Binary:[/] {built_binary}")
        return

    print(f"[bold]$ {' '.join(do_build_cmd)}[/]")

    if dry_run:
        print("[yellow]⚠️ Dry run only — commands not executed.[/]")
        return

    try:
        run_subprocess(do_build_cmd, cwd=launcher_dir)
    except subprocess.CalledProcessError as e:
        print(f"[bold red]❌ Build process failed during: {e.cmd}[/]")
        raise typer.Exit(code=e.returncode)

    if not binary_path.exists() and not has_custom_stage_script(
        launcher_dir,
        LaunchStage.BUILD,
    ):
        print(f"[bold red]❌ Expected binary not found:[/] {binary_path}")
        raise typer.Exit(code=1)

    if not binary_path.exists():
        print("[bold green]✅ Building complete! Custom build stage owns its output.[/]")
        return

    print(f"[bold green]✅ Building complete! Binary:[/] {binary_path}")
