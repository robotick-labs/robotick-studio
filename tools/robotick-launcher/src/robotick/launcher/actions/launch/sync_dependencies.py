# robotick/launcher/actions/launch/sync_dependencies.py

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional, Set, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from rich import print

from robotick.launcher.utils import run_subprocess
from robotick.launcher.discover_deps import collect_all_dependencies


ARCHIVE_METADATA_FILENAME = ".archive_source.json"
ARCHIVE_STUB_FILENAME = ".archive_stub"


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


def _normalize_repo_url(repo: str) -> str:
    repo = repo.rstrip("/")
    if repo.endswith(".git"):
        repo = repo[: -len(".git")]
    return repo


def _archive_download_url(src) -> str:
    url = getattr(src, "url", None)
    if url:
        return url
    repo = getattr(src, "repo", None)
    asset = getattr(src, "asset", None)
    pin = getattr(src, "pin", None)
    if not (repo and asset and pin):
        raise ValueError(
            "git_source_archive source requires either 'url' or repo/pin/asset fields."
        )
    base = _normalize_repo_url(repo)
    return f"{base}/releases/download/{pin}/{asset}"


def _download_url_to_path(url: str, dest: Path) -> None:
    with urlopen(url) as response, dest.open("wb") as fh:
        shutil.copyfileobj(response, fh)


def _normalize_checksum(checksum: str) -> tuple[str, str]:
    raw = checksum.strip()
    if ":" in raw:
        algo, digest = raw.split(":", 1)
    else:
        algo, digest = "sha256", raw
    return algo.lower(), digest.strip().lower()


def _verify_archive_checksum(path: Path, checksum: str) -> None:
    algo, expected = _normalize_checksum(checksum)
    if algo != "sha256":
        raise ValueError(f"Unsupported checksum algorithm: {algo}")
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    actual = digest.hexdigest().lower()
    if actual != expected:
        raise RuntimeError(
            f"Checksum mismatch for archive {path.name}: expected {expected}, got {actual}"
        )


def _archive_metadata_matches(dest: Path, meta: dict) -> bool:
    if not dest.exists():
        return False
    meta_path = dest / ARCHIVE_METADATA_FILENAME
    if not meta_path.exists():
        return False
    try:
        existing = json.loads(meta_path.read_text())
    except Exception:
        return False
    for key, value in meta.items():
        if existing.get(key) != value:
            return False
    return True


def _write_archive_metadata(dest: Path, meta: dict) -> None:
    meta_path = dest / ARCHIVE_METADATA_FILENAME
    meta_path.write_text(json.dumps(meta, indent=2, sort_keys=True))


def _copy_with_strip(source_root: Path, dest_root: Path, strip_components: int) -> None:
    copied_any = False
    strip = max(0, int(strip_components or 0))
    for root, dirs, files in os.walk(source_root):
        rel_root = Path(root).relative_to(source_root)
        rel_parts = rel_root.parts
        if rel_parts and rel_parts[0] == "__MACOSX":
            dirs.clear()
            files[:] = []
            continue
        if strip and len(rel_parts) < strip:
            # keep descending until we've stripped enough components
            continue
        if len(rel_parts) > strip:
            target_dir = dest_root.joinpath(*rel_parts[strip:])
            target_dir.mkdir(parents=True, exist_ok=True)
        for fname in files:
            if fname == ".DS_Store":
                continue
            rel_file = (Path(root) / fname).relative_to(source_root)
            rel_parts = rel_file.parts
            if rel_parts and rel_parts[0] == "__MACOSX":
                continue
            if len(rel_parts) <= strip:
                continue
            target_file = dest_root.joinpath(*rel_parts[strip:])
            target_file.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(Path(root) / fname, target_file)
            copied_any = True
    if not copied_any:
        raise RuntimeError(
            "Archive extraction produced no files after applying strip_components."
        )


def _install_git_source_archive(
    dest: Path, src, *, dry_run: bool, stub_install: bool
) -> None:
    url = _archive_download_url(src)
    strip_components = max(0, int(getattr(src, "strip_components", 0) or 0))
    checksum = getattr(src, "checksum", None)
    repo = getattr(src, "repo", None)
    asset = getattr(src, "asset", None)
    pin = getattr(src, "pin", None)
    meta = {
        "type": "git_source_archive",
        "url": url,
        "repo": repo,
        "asset": asset,
        "pin": pin,
        "strip_components": strip_components,
        "checksum": checksum,
    }
    meta = {k: v for k, v in meta.items() if v is not None}

    label = asset or url
    if dry_run:
        print(f"[yellow]↪︎ DRY-RUN[/] would fetch archive {label} -> {dest}")
        return
    if stub_install:
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True, exist_ok=True)
        (dest / ARCHIVE_STUB_FILENAME).write_text(label or "archive")
        return

    if _archive_metadata_matches(dest, meta):
        print(f"[dim]✓ Archive {dest.name} already provisioned ({label})[/dim]")
        return

    if dest.exists():
        shutil.rmtree(dest)

    print(f"[green]• Fetching[/]  {dest.name}  ([dim]{label}[/dim])")
    tmp_dir = Path(tempfile.mkdtemp(prefix="robotick-archive-"))
    try:
        archive_path = tmp_dir / "payload"
        try:
            _download_url_to_path(url, archive_path)
        except (HTTPError, URLError) as exc:
            raise RuntimeError(f"Failed to download archive {url}: {exc}") from exc

        if checksum:
            _verify_archive_checksum(archive_path, checksum)

        extract_dir = tmp_dir / "extract"
        extract_dir.mkdir(parents=True, exist_ok=True)
        shutil.unpack_archive(str(archive_path), str(extract_dir))

        dest.mkdir(parents=True, exist_ok=True)
        _copy_with_strip(extract_dir, dest, strip_components)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    _write_archive_metadata(dest, meta)


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

        src_type = getattr(src, "type", None)
        if src_type not in {"git", "git_source_archive"}:
            continue

        url: str = getattr(src, "url", None)
        pin: Optional[str] = getattr(src, "pin", None)
        name: str = dep.name or (
            url.rsplit("/", 1)[-1].replace(".git", "") if url else "unknown"
        )

        dest_folder = getattr(src, "dest", None) or name
        dest = dependencies_dir / dest_folder

        if src_type == "git" and not url:
            print(f"[yellow]⚠️ Skipping git dep with no URL: {dep}")
            continue

        archive_url: Optional[str] = None
        if src_type == "git_source_archive":
            try:
                archive_url = _archive_download_url(src)
            except ValueError as exc:
                print(f"[red]❌ archive config error:[/] {exc}")
                continue

        sig_identifier = archive_url if src_type == "git_source_archive" else url
        sig = (sig_identifier, pin)
        if sig in seen:
            continue
        seen.add(sig)

        try:
            if src_type == "git":
                _git_clone_or_fetch(
                    dest, url, pin, dry_run=dry_run, stub_install=stub_install
                )
                installed.append((name, url, pin, dest))
            else:
                _install_git_source_archive(
                    dest, src, dry_run=dry_run, stub_install=stub_install
                )
                installed.append((name, archive_url or "archive", pin, dest))
        except subprocess.CalledProcessError as e:
            print(f"[red]❌ git error:[/] {e}\n    url={url} pin={pin} dest={dest}")
        except Exception as e:
            print(f"[red]❌ archive error:[/] {e}\n    url={archive_url} dest={dest}")

    return installed, sorted(apt_packages)
