"""Workspace-hydration stage for launcher projects.

This is the user-facing replacement for the older install-deps stage. The
implementation now lives in project_workspace_hydration.py, while the public
concept has changed: this stage prepares mutable workspace state under
.launcher/.../deps/... and does not define the container/toolchain environment.
That responsibility now belongs to prepare-project-docker.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer

from robotick.launcher.actions.launch.project_workspace_hydration import (
    ProjectWorkspaceHydrationResult as PrepareProjectWorkspaceResult,
    get_project_python_dir,
    hydrate_project_workspace,
    load_python_root_lock,
)


def prepare_project_workspace(
    project: str,
    base_dir: Path,
    workspace_root: Path,
    *,
    dry_run: bool = False,
    stub_install: bool = False,
    model: Optional[str] = None,
    target: str = "linux",
) -> Optional[PrepareProjectWorkspaceResult]:
    """Hydrate persistent workspace state for the selected project/target."""

    return hydrate_project_workspace(
        project=project,
        base_dir=base_dir,
        workspace_root=workspace_root,
        dry_run=dry_run,
        stub_install=stub_install,
        model=model,
        target=target,
    )


def prepare_project_workspace_command(
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
        None, help="Model to prepare workspace state for (default: all models)"
    ),
    target: str = typer.Option("linux", help="Target name (linux/esp32/...)"),
) -> None:
    """CLI entrypoint for workspace hydration.

    This stays thin on purpose so that tests and internal callers can use the
    same implementation function without going through Typer.
    """

    base_dir = base_dir.resolve()
    workspace_root = (workspace_dir or base_dir).resolve()
    prepare_project_workspace(
        project=project,
        base_dir=base_dir,
        workspace_root=workspace_root,
        dry_run=dry_run,
        stub_install=stub_install,
        model=model,
        target=target,
    )
