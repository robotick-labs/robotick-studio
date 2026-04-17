"""Workspace hydration for launcher projects.

This module owns the mutable state that should live in the checked-out
workspace under .launcher/.../deps/... such as Python venvs, runtime repo
checkouts, and lockfiles. It does not define the container or system dependency
contract for a project; that job now lives in prepare-project-docker.
"""

from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from rich import print
import typer

from robotick.launcher.config import Config, PythonRootConfig
from robotick.launcher.actions.query.list import list_project_models
from robotick.launcher.runtime_lock import load_runtime_lock, write_runtime_lock


LAUNCHER_ROOT = ".launcher"
PYTHON_DIRNAME = "python"
PY_VENV_DIRNAME = ".venv-python"
LOCK_FILENAME = "python-roots-lock.json"
RUNTIME_DIRNAME = "runtime"


@dataclass
class ProjectWorkspaceHydrationResult:
    venv_path: Path
    lock_path: Path
    site_packages: Optional[str]
    python_roots: List[PythonRootConfig]


@dataclass
class RuntimeRepoSpec:
    category: str  # 'engine', 'workload_sources', or 'shared'
    folder: str  # directory name used on disk (e.g., 'engine', 'workloads', 'shared')
    entry_id: Optional[str]
    repo: str
    ref: str
    dest_dir: Path
    override_path: str
    label: str


@contextlib.contextmanager
def _runtime_repo_lock(
    project_dir: Path, project_safe: str, *, timeout: float = 300.0
) -> None:
    lock_dir = project_dir / LAUNCHER_ROOT / project_safe / "deps" / RUNTIME_DIRNAME
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = lock_dir / ".install.lock"
    start = time.time()
    notified_wait = False
    fd: Optional[int] = None

    def _pid_alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    while True:
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            os.write(fd, str(os.getpid()).encode("utf-8"))
            if notified_wait:
                print(
                    f"[green]🔓 prepare-project-workspace lock acquired:[/] {lock_path}"
                )
            break
        except FileExistsError:
            holder = None
            try:
                holder = lock_path.read_text().strip()
            except Exception:
                holder = None

            if holder and holder.isdigit():
                pid = int(holder)
                if not _pid_alive(pid):
                    try:
                        lock_path.unlink()
                        print(
                            f"[yellow]⚠️ prepare-project-workspace lock held by stale pid {pid}; removing stale lock[/] {lock_path}"
                        )
                        continue
                    except OSError:
                        pass

            if not notified_wait:
                owner_msg = f" (pid {holder})" if holder else ""
                print(
                    f"[yellow]⏳ prepare-project-workspace already running{owner_msg}; waiting for lock[/] {lock_path}"
                )
                notified_wait = True
            if (time.time() - start) > timeout:
                raise RuntimeError(
                    f"Timed out waiting for runtime repo lock at {lock_path}. "
                    "If no other prepare-project-workspace command is running, remove the lock file."
                )
            time.sleep(0.5)
    try:
        yield
    finally:
        if fd is not None:
            os.close(fd)
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass
    label: str


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
    if not requirements_files:
        print(
            "[dim][Launcher] prepare-project-workspace: no python requirements files; skipping pip install.[/]"
        )
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


def _slugify_repo_label(entry: Dict[str, Any]) -> str:
    if entry.get("id"):
        base = entry["id"]
    else:
        repo = str(entry.get("repo", "repo")).rstrip("/")
        base = repo.split("/")[-1]
    if base.endswith(".git"):
        base = base[:-4]
    sanitized = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in base)
    sanitized = sanitized.strip("_") or "repo"
    return sanitized.lower()


def _path_override_for_dest(dest: Path, base_dir: Path) -> str:
    try:
        rel = dest.resolve().relative_to(base_dir.resolve())
        return rel.as_posix()
    except ValueError:
        return dest.resolve().as_posix()


def _collect_runtime_repo_specs(
    config: Config, workspace_root: Path, target: str
) -> List[RuntimeRepoSpec]:
    runtime_cfg = getattr(config, "runtime", {}) or {}
    if not runtime_cfg:
        return []

    specs: List[RuntimeRepoSpec] = []
    project_safe = config.project_name.replace("-", "_")
    target_name = target or "linux"
    runtime_root = (
        workspace_root
        / LAUNCHER_ROOT
        / project_safe
        / "deps"
        / RUNTIME_DIRNAME
        / target_name
    )

    def append_entry(entry: Dict[str, Any], category: str, folder: str) -> None:
        if not entry or not isinstance(entry, dict):
            return
        if entry.get("local_path"):
            return
        repo = entry.get("repo")
        ref = entry.get("ref")
        if not repo or not ref:
            return
        slug = _slugify_repo_label(entry)
        dest = runtime_root / folder / slug
        override = _path_override_for_dest(dest, config.base_dir)
        specs.append(
            RuntimeRepoSpec(
                category=category,
                folder=folder,
                entry_id=entry.get("id"),
                repo=repo,
                ref=ref,
                dest_dir=dest,
                override_path=override,
                label=entry.get("id") or slug,
            )
        )

    engine_entry = runtime_cfg.get("engine")
    if engine_entry:
        append_entry(engine_entry, "engine", "engine")

    for entry in runtime_cfg.get("workload_sources") or []:
        append_entry(entry, "workload_sources", "workloads")

    for entry in runtime_cfg.get("shared") or []:
        append_entry(entry, "shared", "shared")

    return specs


def _git_checkout_runtime_repo(
    spec: RuntimeRepoSpec, *, dry_run: bool, stub_install: bool
) -> Optional[str]:
    dest = spec.dest_dir
    repo = spec.repo
    ref = spec.ref
    if dry_run:
        print(
            f"[yellow]DRY RUN:[/] would sync runtime repo '{spec.label}' ({repo}@{ref}) → {dest}"
        )
        return None
    if stub_install:
        print(
            f"[yellow]⚠️ Stub install — skipping runtime repo '{spec.label}' ({repo}@{ref})[/]"
        )
        return None

    dest.parent.mkdir(parents=True, exist_ok=True)
    if (dest / ".git").exists():
        print(
            f"[cyan]• Updating runtime repo[/] {spec.label} ([dim]{repo}@{ref}[/dim])"
        )
        subprocess.run(
            ["git", "fetch", "--all", "--tags", "--prune"], cwd=dest, check=True
        )
    elif dest.exists():
        raise RuntimeError(
            f"Runtime repo destination exists but is not a git repo: {dest}"
        )
    else:
        print(
            f"[green]• Cloning runtime repo[/] {spec.label} ([dim]{repo}@{ref}[/dim])"
        )
        subprocess.run(["git", "clone", repo, str(dest)], check=True)

    subprocess.run(["git", "checkout", ref], cwd=dest, check=True)
    subprocess.run(
        ["git", "submodule", "update", "--init", "--recursive"], cwd=dest, check=True
    )
    commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=dest, text=True
    ).strip()
    return commit


def _sync_runtime_repo_sources(
    config: Config,
    workspace_root: Path,
    target: str,
    *,
    dry_run: bool,
    stub_install: bool,
) -> None:
    """Clone/update runtime repos into the workspace-owned launcher cache.

    These repos are mutable project state rather than image-level toolchain
    inputs, so they stay under .launcher/.../deps/runtime instead of being baked
    into the shared or derived Docker images.
    """

    specs = _collect_runtime_repo_specs(config, workspace_root, target)
    if not specs:
        return

    project_safe = config.project_name.replace("-", "_")
    if dry_run or stub_install:
        for spec in specs:
            _git_checkout_runtime_repo(spec, dry_run=dry_run, stub_install=stub_install)
        return

    entries: Dict[str, Any] = {
        "engine": None,
        "workload_sources": [],
        "shared": [],
    }
    timestamp = datetime.now(timezone.utc).isoformat()

    for spec in specs:
        commit = _git_checkout_runtime_repo(
            spec, dry_run=dry_run, stub_install=stub_install
        )
        if commit is None:
            continue
        lock_entry = {
            "id": spec.entry_id,
            "repo": spec.repo,
            "ref": spec.ref,
            "path": spec.override_path,
            "commit": commit,
            "updated_at": timestamp,
        }
        if spec.category == "engine":
            entries["engine"] = lock_entry
        else:
            entries[spec.category].append(lock_entry)

    lock_data = load_runtime_lock(config.project_dir, project_safe) or {}
    targets = lock_data.get("targets") or {}
    targets[target] = {
        "generated_at": timestamp,
        "engine": entries["engine"],
        "workload_sources": entries["workload_sources"],
        "shared": entries["shared"],
    }
    lock_data["project"] = config.project_name
    lock_data["updated_at"] = timestamp
    lock_data["targets"] = targets
    write_runtime_lock(
        config.project_dir,
        project_safe,
        lock_data,
        dry_run=dry_run,
    )


def _hydrate_project_workspace_locked(
    *,
    config: Config,
    project: str,
    base_dir: Path,
    workspace_root: Path,
    dry_run: bool,
    stub_install: bool,
    model: Optional[str],
    target: str,
) -> ProjectWorkspaceHydrationResult:
    """Perform the locked workspace-hydration work.

    The lock ensures multiple launcher invocations do not race while updating
    shared workspace state such as runtime repo checkouts or the project Python
    venv.
    """

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
                    "requirements": (
                        str(root.requirements_file) if root.requirements_file else None
                    ),
                }
                for root in python_roots
            ],
        }

        _write_lock(lock_path, lock_payload, dry_run=dry_run)
    else:
        print("[yellow]ℹ️ No python_roots defined; skipping python venv hydration.[/]")
        try:
            if lock_path.exists():
                if dry_run:
                    print(f"[yellow]DRY RUN:[/] would remove stale lockfile {lock_path}")
                else:
                    lock_path.unlink()
                    print(f"[green]🧹 Removed stale python deps lock:[/] {lock_path}")
        except FileNotFoundError:
            pass
        except OSError as exc:
            print(
                f"[red]⚠️ Failed to remove stale python deps lock {lock_path}:[/] {exc}"
            )

    _sync_runtime_repo_sources(
        config=config,
        workspace_root=workspace_root,
        target=target,
        dry_run=dry_run,
        stub_install=stub_install,
    )

    return ProjectWorkspaceHydrationResult(
        venv_path=venv_path,
        lock_path=lock_path,
        site_packages=site_packages,
        python_roots=config.python_roots,
    )


def hydrate_project_workspace(
    project: str,
    base_dir: Path,
    workspace_root: Path,
    *,
    dry_run: bool = False,
    stub_install: bool = False,
    model: Optional[str] = None,
    target: str = "linux",
) -> Optional[ProjectWorkspaceHydrationResult]:
    """
    Hydrate mutable project workspace state under .launcher/<project>/deps/.

    This intentionally excludes image-level concerns such as apt packages,
    toolchains, or third-party source archives that now belong to the
    prepare-project-docker stage.
    """

    base_dir = base_dir.resolve()
    workspace_root = workspace_root.resolve()

    print(
        "[Launcher] prepare-project-workspace: hydrating "
        f"{project}/{target} workspace state under .launcher/..."
    )

    config = Config(
        project,
        model=None,
        target=None,
        base_dir=base_dir,
        dry_run=dry_run,
        stub_install=stub_install,
    )

    project_safe = config.project_name.replace("-", "_")

    with _runtime_repo_lock(config.project_dir, project_safe):
        return _hydrate_project_workspace_locked(
            config=config,
            project=project,
            base_dir=base_dir,
            workspace_root=workspace_root,
            dry_run=dry_run,
            stub_install=stub_install,
            model=model,
            target=target,
        )


def get_project_python_dir(project: str, workspace_root: Path) -> Path:
    """Return the workspace-owned python hydration folder for a project."""

    project_safe = project.replace("-", "_")
    return workspace_root / LAUNCHER_ROOT / project_safe / "deps" / PYTHON_DIRNAME


def load_python_root_lock(project: str, workspace_root: Path) -> Optional[dict]:
    """Load the recorded Python hydration state, if present."""

    python_dir = get_project_python_dir(project, workspace_root)
    lock_path = python_dir / LOCK_FILENAME
    if not lock_path.exists():
        return None
    try:
        return json.loads(lock_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"[yellow]⚠️ Failed to parse lockfile:[/] {lock_path}")
        return None


def hydrate_project_workspace_command(
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
    hydrate_project_workspace(
        project=project,
        base_dir=base_dir,
        workspace_root=workspace_root,
        dry_run=dry_run,
        stub_install=stub_install,
        model=model,
        target=target,
    )
