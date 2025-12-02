# robotick/launcher/actions/launch/sync_dependencies.py

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import List, Optional, Set, Tuple

from rich import print

from robotick.launcher.utils import run_subprocess
from robotick.launcher.discover_deps import collect_all_dependencies


def _run(cmd: List[str], cwd: Optional[Path] = None, dry_run: bool = False) -> None:
    if dry_run:
        pretty = " ".join(cmd)
        here = f" (cwd={cwd})" if cwd else ""
        print(f"[yellow]↪︎ DRY-RUN[/] {pretty}{here}")
        return
    run_subprocess(cmd, cwd=cwd)


def _ensure_dir(path: Path, dry_run: bool = False) -> None:
    if dry_run:
        print(f"[yellow]↪︎ DRY-RUN[/] mkdir -p {path}")
        return
    path.mkdir(parents=True, exist_ok=True)


def _resolve_dependencies_dir(config, platform: str) -> Path:
    launcher_dir = Path(getattr(config, "launcher_dir"))
    if platform == "esp32":
        return launcher_dir / "components"
    return launcher_dir / "deps"


def _is_at_pin(repo_path: Path, pin: str) -> bool:
    try:
        current_rev = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=repo_path, text=True
        ).strip()

        try:
            target_rev = subprocess.check_output(
                ["git", "rev-parse", pin], cwd=repo_path, text=True
            ).strip()
        except subprocess.CalledProcessError:
            return False

        return current_rev == target_rev
    except Exception:
        return False


def _git_clone_or_fetch(
    dest: Path, url: str, pin: Optional[str], dry_run: bool, stub_install: bool
) -> None:
    if (dest / ".git_stub").exists() and not stub_install:
        print(f"[blue]• Replacing stub[/] {dest.name} with real repo")
        shutil.rmtree(dest)

    if dest.exists() and (dest / ".git").exists():
        print(f"[cyan]• Updating[/] {dest.name}  ([dim]{url}[/dim])")
        if not stub_install:
            _run(["git", "remote", "set-url", "origin", url], cwd=dest, dry_run=dry_run)
            if pin and not _is_at_pin(dest, pin):
                _run(
                    ["git", "fetch", "--all", "--tags", "--prune"],
                    cwd=dest,
                    dry_run=dry_run,
                )
    elif not dest.exists() or (dest / ".git_stub").exists():
        print(f"[green]• Cloning[/]  {dest.name}  ([dim]{url}[/dim])")
        _ensure_dir(dest.parent, dry_run=dry_run)
        if stub_install:
            if dry_run:
                print(f"[yellow]↪︎ DRY-RUN mkdir {dest} + .git_stub[/]")
            else:
                dest.mkdir(parents=True, exist_ok=True)
                (dest / ".git_stub").touch()
        else:
            _run(["git", "clone", "--depth=1", url, str(dest)], dry_run=dry_run)
    else:
        print(f"[yellow]⚠ Skipping {dest.name} — exists but not a git repo[/]")
        return

    if not stub_install and (dest / ".git").exists():
        if pin:
            if not _is_at_pin(dest, pin):
                print(f"[magenta]  ↳ checkout[/] {pin}")
                _run(["git", "fetch", "--tags", "--prune"], cwd=dest, dry_run=dry_run)
                _run(["git", "checkout", pin], cwd=dest, dry_run=dry_run)
            else:
                print(f"[dim]  ↳ already at {pin}, skipping checkout[/dim]")
        else:
            _run(["git", "pull", "--ff-only"], cwd=dest, dry_run=dry_run)


def sync_model_dependencies(
    config,
) -> Tuple[List[Tuple[str, str, Optional[str], Path]], List[str]]:
    platform = getattr(config, "target", "linux")
    dry_run = bool(getattr(config, "dry_run", False))
    stub_install = bool(getattr(config, "stub_install", False))
    dependencies_dir = _resolve_dependencies_dir(config, platform)

    used_types: Set[str] = set()
    for w in sorted(config.model.get("workloads", []), key=lambda w: w["type"].lower()):
        used_types.add(w["type"])

    deps = collect_all_dependencies(config, platform=platform, allowed_types=used_types)

    apt_packages: Set[str] = set()
    seen: Set[Tuple[str, Optional[str]]] = set()
    installed: List[Tuple[str, str, Optional[str], Path]] = []

    for dep in deps:
        src = dep.source

        if src.type == "apt":
            apt_name = getattr(src, "package", None) or dep.name
            if apt_name:
                apt_packages.add(apt_name)
            continue

        if getattr(src, "type", None) != "git":
            continue

        url: str = getattr(src, "url", None)
        pin: Optional[str] = getattr(src, "pin", None)
        name: str = dep.name or (
            url.rsplit("/", 1)[-1].replace(".git", "") if url else "unknown"
        )

        if not url:
            print(f"[yellow]⚠️ Skipping git dep with no URL: {dep}")
            continue

        sig = (url, pin)
        if sig in seen:
            continue
        seen.add(sig)

        dest = dependencies_dir / name
        try:
            _git_clone_or_fetch(
                dest, url, pin, dry_run=dry_run, stub_install=stub_install
            )
            installed.append((name, url, pin, dest))
        except subprocess.CalledProcessError as e:
            print(f"[red]❌ git error:[/] {e}\n    url={url} pin={pin} dest={dest}")

    return installed, sorted(apt_packages)
