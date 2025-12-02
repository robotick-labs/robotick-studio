from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from rich import print
import typer

from robotick.launcher.config import Config, PythonRootConfig


STUDIO_DIRNAME = ".studio"
PY_VENV_DIRNAME = ".venv-python"
LOCK_FILENAME = "python-roots-lock.json"


@dataclass
class InstallDepsResult:
    venv_path: Path
    lock_path: Path
    site_packages: Optional[str]
    python_roots: List[PythonRootConfig]


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
) -> Optional[InstallDepsResult]:
    """
    Hydrate python_roots into a shared .studio/.venv-python environment.
    """

    config = Config(project, model=None, target=None, base_dir=base_dir, dry_run=dry_run, stub_install=stub_install)

    if not config.python_roots:
        print("[yellow]ℹ️ No python_roots defined; nothing to install.[/]")
        return None

    studio_dir = workspace_root / STUDIO_DIRNAME
    studio_dir.mkdir(parents=True, exist_ok=True)

    venv_path = studio_dir / PY_VENV_DIRNAME
    _ensure_python_venv(venv_path, dry_run=dry_run)
    python_bin = _venv_python_bin(venv_path)

    requirement_files = [
        root.requirements_absolute
        for root in config.python_roots
        if root.requirements_absolute is not None
    ]

    _pip_install(
        python_bin,
        requirement_files,
        dry_run=dry_run,
        stub_install=stub_install,
    )

    site_packages = None
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
            for root in config.python_roots
        ],
    }

    lock_path = studio_dir / LOCK_FILENAME
    _write_lock(lock_path, lock_payload, dry_run=dry_run)

    return InstallDepsResult(
        venv_path=venv_path,
        lock_path=lock_path,
        site_packages=site_packages,
        python_roots=config.python_roots,
    )


def install_deps_command(
    project: str = typer.Argument(..., help="Project name (e.g. 'my_robot')"),
    base_dir: Path = typer.Option(
        Path.cwd(), help="Directory containing <project>.project.yaml"
    ),
    workspace_dir: Path = typer.Option(
        Path.cwd(), help="Workspace root containing the .studio folder"
    ),
    dry_run: bool = typer.Option(False, help="Preview actions without executing them"),
    stub_install: bool = typer.Option(
        False, help="Skip pip install -r (useful for CI smoke tests)"
    ),
) -> None:
    install_deps(
        project=project,
        base_dir=base_dir,
        workspace_root=workspace_dir,
        dry_run=dry_run,
        stub_install=stub_install,
    )
