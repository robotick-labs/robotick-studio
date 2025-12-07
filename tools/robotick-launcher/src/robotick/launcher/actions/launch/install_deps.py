from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Set

from rich import print
import typer

from robotick.launcher.config import Config, PythonRootConfig
from robotick.launcher.actions.launch.sync_dependencies import (
    sync_model_dependencies,
)
from robotick.launcher.actions.query.list import list_project_models


LAUNCHER_ROOT = ".launcher"
PYTHON_DIRNAME = "python"
PY_VENV_DIRNAME = ".venv-python"
LOCK_FILENAME = "python-roots-lock.json"


@dataclass
class InstallDepsResult:
    venv_path: Path
    lock_path: Path
    site_packages: Optional[str]
    python_roots: List[PythonRootConfig]
    git_dependencies: List[tuple[str, str, Optional[str], Path]]
    apt_packages: List[str]
    missing_apt: List[str]


def _collect_model_names(
    project: str, base_dir: Path, specific_model: Optional[str]
) -> List[str]:
    if specific_model:
        return [specific_model]

    project_file = base_dir / f"{project}.project.yaml"
    models = []
    try:
        for rel in list_project_models(str(project_file)):
            name = Path(rel).stem
            if name.endswith(".model"):
                name = name.removesuffix(".model")
            models.append(name)
    except FileNotFoundError:
        print(f"[yellow]⚠️ No models found under {project_file}[/]")
    return models


def _find_missing_apt_packages(packages: Set[str]) -> Set[str]:
    missing: Set[str] = set()
    for pkg in sorted(packages):
        try:
            result = subprocess.run(
                ["dpkg", "-s", pkg],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            if result.returncode != 0:
                missing.add(pkg)
        except Exception:
            missing.add(pkg)
    return missing


def _venv_python_bin(venv_path: Path) -> Path:
    if os.name == "nt":
        return venv_path / "Scripts" / "python.exe"
    return venv_path / "bin" / "python"


def _ensure_python_venv(
    venv_path: Path, *, dry_run: bool = False, python_exe: Optional[str] = None
) -> None:
    if venv_path.exists():
        return
    if dry_run:
        print(f"[yellow]DRY RUN:[/] would create Python venv at {venv_path}")
        return
    python_exe = python_exe or sys.executable
    print(f"[green]🐍 Creating project python venv:[/] {venv_path}")
    subprocess.run([python_exe, "-m", "venv", str(venv_path)], check=True)


def _pip_install(
    python_bin: Path,
    requirements_files: List[Path],
    *,
    dry_run: bool,
    stub_install: bool,
) -> None:
    if stub_install:
        print("[yellow]⚠️  Stub install requested — skipping pip commands.")
        return
    if dry_run:
        for req in requirements_files:
            print(f"[yellow]DRY RUN:[/] would install requirements from {req}")
        return
    subprocess.run(
        [str(python_bin), "-m", "pip", "install", "--upgrade", "pip"], check=True
    )
    for req in requirements_files:
        if not req.exists():
            print(f"[yellow]⚠️ requirements file not found, skipping:[/] {req}")
            continue
        print(f"[green]📦 Installing python deps from[/] {req}")
        subprocess.run(
            [str(python_bin), "-m", "pip", "install", "-r", str(req)],
            check=True,
        )


def _discover_site_packages(python_bin: Path) -> str:
    result = subprocess.run(
        [
            str(python_bin),
            "-c",
            "import sysconfig; print(sysconfig.get_path('purelib'))",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _write_lock(lock_path: Path, payload: dict, *, dry_run: bool) -> None:
    if dry_run:
        print(f"[yellow]DRY RUN:[/] would write lockfile {lock_path}")
        return
    lock_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"[green]🔒 Wrote python deps lock:[/] {lock_path}")


def install_deps(
    project: str,
    base_dir: Path,
    workspace_root: Path,
    *,
    dry_run: bool = False,
    stub_install: bool = False,
    model: Optional[str] = None,
    target: str = "linux",
) -> Optional[InstallDepsResult]:
    """
    Hydrate python_roots into a shared .launcher/<project>/.venv-python environment.
    """

    base_dir = base_dir.resolve()
    workspace_root = workspace_root.resolve()

    config = Config(
        project,
        model=None,
        target=None,
        base_dir=base_dir,
        dry_run=dry_run,
        stub_install=stub_install,
    )

    project_launcher_dir = get_project_python_dir(config.project_name, workspace_root)
    project_launcher_dir.mkdir(parents=True, exist_ok=True)

    venv_path = project_launcher_dir / PY_VENV_DIRNAME
    lock_path = project_launcher_dir / LOCK_FILENAME
    site_packages: Optional[str] = None

    python_roots = config.python_roots

    if python_roots:
        _ensure_python_venv(venv_path, dry_run=dry_run)
        python_bin = _venv_python_bin(venv_path)

        requirement_files = [
            root.requirements_absolute
            for root in python_roots
            if root.requirements_absolute is not None
        ]

        _pip_install(
            python_bin,
            requirement_files,
            dry_run=dry_run,
            stub_install=stub_install,
        )

        if venv_path.exists() and not dry_run:
            site_packages = _discover_site_packages(python_bin)

        lock_payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "project": project,
            "venv_path": str(venv_path),
            "site_packages": site_packages,
            "python_roots": [
                {
                    "id": root.id,
                    "relative_path": str(root.relative_path),
                    "absolute_path": str(root.absolute_path),
                    "requirements": str(root.requirements_file)
                    if root.requirements_file
                    else None,
                }
                for root in python_roots
            ],
        }

        _write_lock(lock_path, lock_payload, dry_run=dry_run)
    else:
        print("[yellow]ℹ️ No python_roots defined; skipping python venv hydration.[/]")

    # --- Repo deps + apt packages ---
    model_names = _collect_model_names(project, base_dir, model)
    git_dependencies: List[tuple[str, str, Optional[str], Path]] = []
    apt_packages: Set[str] = set()

    for model_name in model_names:
        try:
            model_config = Config(
                project, model_name, target, base_dir, dry_run, stub_install
            )
        except Exception as exc:
            print(
                f"[yellow]⚠️ Skipping model '{model_name}' while collecting deps:[/] {exc}"
            )
            continue

        deps, apt = sync_model_dependencies(model_config)
        git_dependencies.extend(deps)
        apt_packages.update(apt)

    missing_apt: List[str] = []
    apt_packages_sorted: List[str] = sorted(apt_packages)
    if apt_packages:
        if dry_run:
            missing_apt = apt_packages_sorted
            print(
                f"[yellow]↪︎ DRY-RUN:[/] would verify apt packages: {', '.join(apt_packages_sorted)}"
            )
        else:
            missing_set = _find_missing_apt_packages(apt_packages)
            missing_apt = sorted(missing_set)
        if missing_apt:
            print(
                f"[yellow]⚠ Missing apt packages:[/] {', '.join(missing_apt)}\n"
                f"[yellow]↳ Please run:[/] sudo apt-get install -y {' '.join(missing_apt)}"
            )
        else:
            print(f"[dim]✓ All required apt packages are installed[/dim]")

    return InstallDepsResult(
        venv_path=venv_path,
        lock_path=lock_path,
        site_packages=site_packages,
        python_roots=config.python_roots,
        git_dependencies=git_dependencies,
        apt_packages=apt_packages_sorted,
        missing_apt=missing_apt,
    )


def get_project_python_dir(project: str, workspace_root: Path) -> Path:
    project_safe = project.replace("-", "_")
    return workspace_root / LAUNCHER_ROOT / project_safe / PYTHON_DIRNAME


def load_python_root_lock(project: str, workspace_root: Path) -> Optional[dict]:
    python_dir = get_project_python_dir(project, workspace_root)
    lock_path = python_dir / LOCK_FILENAME
    if not lock_path.exists():
        return None
    try:
        return json.loads(lock_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"[yellow]⚠️ Failed to parse lockfile:[/] {lock_path}")
        return None


def install_deps_command(
    project: str = typer.Argument(..., help="Project name (e.g. 'my_robot')"),
    base_dir: Path = typer.Option(
        Path.cwd(), help="Directory containing <project>.project.yaml"
    ),
    workspace_dir: Optional[Path] = typer.Option(
        None, help="Workspace root containing the .launcher folder"
    ),
    dry_run: bool = typer.Option(False, help="Preview actions without executing them"),
    stub_install: bool = typer.Option(
        False, help="Skip pip install -r (useful for CI smoke tests)"
    ),
    model: Optional[str] = typer.Option(
        None, help="Model to sync dependencies for (default: all models)"
    ),
    target: str = typer.Option("linux", help="Target name (linux/esp32/...)"),
) -> None:
    base_dir = base_dir.resolve()
    workspace_root = (workspace_dir or base_dir).resolve()
    install_deps(
        project=project,
        base_dir=base_dir,
        workspace_root=workspace_root,
        dry_run=dry_run,
        stub_install=stub_install,
        model=model,
        target=target,
    )
