from pathlib import Path
import subprocess
import sys
from rich import print
import typer
import yaml

from robotick.launcher.utils import get_launcher_paths, run_subprocess


def run(
    project: str = typer.Argument(...),
    model: str = typer.Argument(...),
    target: str = typer.Argument(...),
    base_dir: Path = typer.Option(
        Path.cwd(), help="Base directory containing .launcher"
    ),
):
    launcher_dir, build_dir, binary_path = get_launcher_paths(
        project, model, target, base_dir
    )
    run_script = launcher_dir / "do_launcher_run.sh"

    working_dir = "."
    try:
        project_path = base_dir / f"{project}.project.yaml"
        project_data = yaml.safe_load(project_path.read_text(encoding="utf-8"))
        working_dir_str = project_data.get("working_dir", ".")
        if working_dir_str:
            working_dir = Path(working_dir_str)
            if not working_dir.is_absolute():
                working_dir = (project_path.parent / working_dir).resolve()
                print(
                    f"[bold green]🚀 Detected working-directory from project.yaml: {working_dir}"
                )
    except Exception as e:
        working_dir = "."

    print(
        "============================================================================================"
    )
    print(f"[dim]🔍 Looking for run script at: {run_script}[/]")

    if run_script.exists():
        print(f"[bold green]🚀 Running [cyan]{run_script}[/] instead of binary[/]")
        try:
            run_subprocess(["bash", str(run_script)], cwd=working_dir)
        except subprocess.CalledProcessError as e:
            print(f"[bold red]❌ Script exited with code {e.returncode}[/]")
            raise typer.Exit(code=e.returncode)
    else:
        print(f"[bold green]🚀 Running binary: [cyan]{binary_path}[/]")
        if not binary_path.exists():
            print(f"[bold red]❌ Binary not found: {binary_path}[/]")
            raise typer.Exit(code=1)

        try:
            run_subprocess([str(binary_path)], cwd=working_dir)
        except subprocess.CalledProcessError as e:
            print(f"[bold red]❌ Program exited with code {e.returncode}[/]")
            raise typer.Exit(code=e.returncode)
