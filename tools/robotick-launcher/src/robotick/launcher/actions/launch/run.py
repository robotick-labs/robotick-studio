import json
import os
from pathlib import Path
from typing import Optional
import subprocess
import sys
import shlex
import signal
import time
from rich import print
import typer
import yaml
from typer.models import OptionInfo

from robotick.launcher.actions.launch.target_plan import resolve_target_plan
from robotick.launcher.utils import get_launcher_paths, run_subprocess
from robotick.launcher.actions.launch.install_deps import load_python_root_lock


def _build_python_env(project: str, workspace_root: Path) -> Optional[dict[str, str]]:
    lock = load_python_root_lock(project, workspace_root)
    if not lock:
        return None

    entries: list[str] = []
    site_packages = lock.get("site_packages")
    if site_packages:
        entries.append(site_packages)

    for root in lock.get("python_roots", []):
        path = root.get("absolute_path")
        if path:
            entries.append(path)

    entries = [p for p in entries if p]
    if not entries:
        return None

    pythonpath = os.pathsep.join(entries)
    env = os.environ.copy()
    existing = env.get("PYTHONPATH")
    if existing:
        pythonpath = pythonpath + os.pathsep + existing
    env["PYTHONPATH"] = pythonpath
    if lock.get("venv_path"):
        env["ROBOTICK_PYTHON_VENV"] = lock["venv_path"]
    return env


def _find_local_process_ids_for_binary(
    binary_path: Path, *, proc_root: Path = Path("/proc")
) -> list[int]:
    resolved_binary = binary_path.resolve()
    matching_pids: list[int] = []

    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            pid = int(entry.name)
            exe_path = (entry / "exe").resolve()
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
        except OSError:
            continue

        if exe_path == resolved_binary:
            matching_pids.append(pid)

    return matching_pids


def _stop_existing_local_process(binary_path: Path, *, dry_run: bool) -> None:
    resolved_binary = binary_path.resolve()
    matching_pids = _find_local_process_ids_for_binary(resolved_binary)

    if not matching_pids:
        print(f"[dim][Launcher] No existing local instance for {resolved_binary}[/]")
        return

    print(f"[Launcher] Stopping existing local instance: {resolved_binary}")
    if dry_run:
        print(f"[bold]$ stop local pids for {resolved_binary}: {matching_pids}[/]")
        return

    alive_pids = matching_pids.copy()
    for pid in alive_pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    deadline = time.time() + 5.0
    while time.time() < deadline:
        still_alive: list[int] = []
        for pid in alive_pids:
            if Path(f"/proc/{pid}").exists():
                still_alive.append(pid)
        if not still_alive:
            return
        alive_pids = still_alive
        time.sleep(0.2)

    for pid in alive_pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def run(
    project: str = typer.Argument(...),
    model: str = typer.Argument(...),
    target: str = typer.Argument(...),
    base_dir: Path = typer.Option(
        Path.cwd(), help="Base directory containing .launcher"
    ),
    workspace_dir: Optional[Path] = typer.Option(
        None, help="Workspace root containing the .launcher folder"
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Print commands without executing them"
    ),
):
    if isinstance(workspace_dir, OptionInfo):
        workspace_dir = None
    base_dir = base_dir.resolve()
    workspace_root = (workspace_dir or base_dir).resolve()
    launcher_dir, build_dir, binary_path = get_launcher_paths(
        project, model, target, base_dir
    )
    plan = resolve_target_plan(project, model, target, base_dir)
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
    except FileNotFoundError as err:
        print(f"[yellow]⚠️ Project file missing ({project_path}): {err}[/]")
        working_dir = "."
    except yaml.YAMLError as err:
        print(f"[yellow]⚠️ Failed to parse project YAML ({project_path}): {err}[/]")
        working_dir = "."

    python_env = _build_python_env(project, workspace_root)

    print(
        "============================================================================================"
    )
    print(f"[dim]🔍 Looking for run script at: {run_script}[/]")
    print(f"[cyan]🧭 Run strategy:[/] {plan.run.strategy}")
    plan.run.print_summary()
    if plan.run.run_handler is not None:
        # Non-local runs use a one-model-at-a-time policy for the same binary path.
        if plan.run.stop_handler is not None:
            plan.run.stop_handler(dry_run)
        plan.run.run_handler(dry_run)
        if dry_run:
            print("[yellow]⚠️ Dry run only — commands not executed.[/]")
        return

    _stop_existing_local_process(binary_path, dry_run=dry_run)
    if dry_run:
        if run_script.exists() and plan.run.supports_script_dry_run:
            dry_run_env = dict(python_env or os.environ.copy())
            dry_run_env["ROBOTICK_LAUNCHER_DRY_RUN"] = "1"
            run_subprocess(["bash", str(run_script)], cwd=working_dir, env=dry_run_env)
        print("[yellow]⚠️ Dry run only — commands not executed.[/]")
        return

    if run_script.exists():
        print(f"[bold green]🚀 Running [cyan]{run_script}[/] instead of binary[/]")
        try:
            run_subprocess(
                ["bash", str(run_script)], cwd=working_dir, env=python_env
            )
        except subprocess.CalledProcessError as e:
            print(f"[bold red]❌ Script exited with code {e.returncode}[/]")
            raise typer.Exit(code=e.returncode)
    else:
        print(f"[bold green]🚀 Running binary: [cyan]{binary_path}[/]")
        if not binary_path.exists():
            print(f"[bold red]❌ Binary not found: {binary_path}[/]")
            raise typer.Exit(code=1)

        try:
            run_subprocess([str(binary_path)], cwd=working_dir, env=python_env)
        except subprocess.CalledProcessError as e:
            print(f"[bold red]❌ Program exited with code {e.returncode}[/]")
            raise typer.Exit(code=e.returncode)
