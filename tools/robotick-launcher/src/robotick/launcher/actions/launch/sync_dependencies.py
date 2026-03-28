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
from urllib.parse import urlparse
from urllib.request import urlopen

from rich import print

from robotick.launcher.utils import run_subprocess
from robotick.launcher.discover_deps import collect_all_dependencies


ARCHIVE_METADATA_FILENAME = ".archive_source.json"
ARCHIVE_STUB_FILENAME = ".archive_stub"


def _run(cmd: List[str], cwd: Optional[Path] = None, dry_run: bool = False) -> None:
    """
    Execute a command or, when in dry-run mode, print what would be executed.
    
    If dry_run is True, prints a human-readable dry-run message showing the command and optional working directory instead of executing it. Otherwise delegates execution to the underlying subprocess runner.
    
    Parameters:
        cmd (List[str]): Command and arguments to run (as a list of tokens).
        cwd (Optional[Path]): Working directory in which to run the command; if None, uses the current process directory.
        dry_run (bool): When True, do not execute the command and only display the dry-run message.
    """
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
    """
    Determine the directory where dependencies should be placed for a given platform.
    
    Parameters:
        config: Object with a `launcher_dir` attribute pointing to the base launcher directory.
        platform (str): Target platform identifier; "esp32" maps to the "components" subdirectory, all other values map to the "deps" subdirectory.
    
    Returns:
        Path: Resolved dependencies directory under the launcher's directory.
    """
    launcher_dir = Path(getattr(config, "launcher_dir"))
    if platform == "esp32":
        return launcher_dir / "components"
    return launcher_dir / "deps"


def _normalize_repo_url(repo: str) -> str:
    """
    Normalize a Git repository URL or path by removing a trailing slash and an optional `.git` suffix.
    
    Parameters:
        repo (str): Repository URL or path to normalize.
    
    Returns:
        str: The normalized repository URL/path without a trailing slash or `.git` suffix.
    """
    repo = repo.rstrip("/")
    if repo.endswith(".git"):
        repo = repo[: -len(".git")]
    return repo


def _archive_download_url(src) -> str:
    """
    Compute the HTTP download URL for a git-source archive.
    
    If `src.url` is present, that value is returned. Otherwise constructs a GitHub-style
    release asset URL from `repo`, `pin`, and `asset` attributes on `src`.
    
    Parameters:
        src: An object with either a `url` attribute, or `repo`, `pin`, and `asset`
             attributes used to construct the download location.
    
    Returns:
        url (str): The resolved download URL (either `src.url` or
                   "<normalized_repo>/releases/download/<pin>/<asset>").
    
    Raises:
        ValueError: If neither `url` is provided nor all of `repo`, `pin`, and `asset`
                    are present on `src`.
    """
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
    """
    Download the content at the given URL and write it to the destination file.
    
    Parameters:
        url (str): HTTP(S) URL of the resource to download.
        dest (Path): Filesystem path to write the downloaded bytes to; existing file will be overwritten.
    """
    with urlopen(url) as response, dest.open("wb") as fh:
        shutil.copyfileobj(response, fh)


def _normalize_checksum(checksum: str) -> tuple[str, str]:
    """
    Parse a checksum string into its algorithm and digest components.
    
    Parameters:
        checksum (str): Checksum string in the form "algorithm:digest" or just "digest". Leading/trailing whitespace is permitted.
    
    Returns:
        tuple[str, str]: A pair (algorithm, digest) where `algorithm` is lowercased (defaults to "sha256" if omitted) and `digest` is trimmed and lowercased.
    """
    raw = checksum.strip()
    if ":" in raw:
        algo, digest = raw.split(":", 1)
    else:
        algo, digest = "sha256", raw
    return algo.lower(), digest.strip().lower()


def _verify_archive_checksum(path: Path, checksum: str) -> None:
    """
    Validate that the file at `path` matches the provided checksum.
    
    Parameters:
    	path (Path): Path to the archive file to verify.
    	checksum (str): Checksum string either in the form `algorithm:digest` or a bare hex digest (a bare value is treated as `sha256`). Comparison is case-insensitive.
    
    Raises:
    	ValueError: If the checksum specifies an algorithm other than `sha256`.
    	RuntimeError: If the computed SHA-256 digest does not match the expected digest.
    """
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
    """
    Check whether an archive already provisioned at `dest` has metadata that matches the provided `meta`.
    
    Parameters:
        dest (Path): Destination directory where the archive is installed.
        meta (dict): Expected metadata mapping keys to values; each key/value pair must equal the corresponding entry in the stored metadata.
    
    Returns:
        bool: `True` if a metadata file exists at `dest` and every key in `meta` equals the corresponding value in the stored metadata, `False` otherwise.
    """
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
    """
    Write archive metadata to a metadata file inside the destination directory.
    
    Parameters:
        dest (Path): Directory where the metadata file will be created.
        meta (dict): Metadata to serialize and store; keys should be JSON-serializable.
    
    Notes:
        The metadata is written as formatted JSON to the file named by ARCHIVE_METADATA_FILENAME within `dest`.
    """
    meta_path = dest / ARCHIVE_METADATA_FILENAME
    meta_path.write_text(json.dumps(meta, indent=2, sort_keys=True))


def _copy_with_strip(source_root: Path, dest_root: Path, strip_components: int) -> None:
    """
    Copy files from an extracted archive tree into a destination while removing a specified number of leading path components.
    
    Parameters:
        source_root (Path): Root directory of the extracted archive to copy from.
        dest_root (Path): Destination directory to copy files into; intermediate directories are created as needed.
        strip_components (int): Number of leading path components to remove from each source file's relative path before writing to the destination (use 0 to keep full relative paths).
    
    Details:
        - Skips any top-level "__MACOSX" entries and any ".DS_Store" files.
        - Preserves file metadata when copying (uses shutil.copy2).
        - Raises RuntimeError if no files are copied after applying strip_components.
    """
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
    """
    Install a git-hosted source archive into the destination directory and record its provisioning metadata.
    
    Downloads the archive identified by `src` (or uses the provided asset name), optionally verifies its checksum, extracts its contents while stripping leading path components, and writes metadata to mark the destination as provisioned. In dry-run mode the function only reports the planned action. In stub-install mode the function creates a stub marker instead of downloading or extracting. If the destination already matches the archive metadata, no action is taken.
    
    Parameters:
        dest (Path): Filesystem path where the archive contents should be installed.
        src: Source descriptor object containing archive fields such as `url`, `repo`, `asset`, `pin`, `strip_components`, and `checksum`.
        dry_run (bool): If true, do not perform filesystem or network changes; only report the intended action.
        stub_install (bool): If true, create a provisioning stub at `dest` instead of performing a real install.
    
    Raises:
        RuntimeError: If the archive download fails or if a checksum verification fails.
    """
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
        asset_name = getattr(src, "asset", None)
        if asset_name:
            archive_filename = asset_name
        else:
            parsed = urlparse(url)
            archive_filename = Path(parsed.path).name or "payload"
        archive_path = tmp_dir / archive_filename
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
    """
    Check whether the Git repository at repo_path is at the specified revision (pin).
    
    Parameters:
        repo_path (Path): Path to the local Git repository.
        pin (str): Revision identifier to compare (commit hash, tag, or ref).
    
    Returns:
        `true` if the repository's HEAD matches the specified pin, `false` otherwise.
    """
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


def _find_local_esp32_component(config, component_name: str) -> Optional[Path]:
    runtime = getattr(config, "runtime", {}) or {}
    for entry in runtime.get("workload_sources") or []:
        local_path = entry.get("local_path") or entry.get("path_override")
        if not local_path:
            continue
        source_root = config.resolve_project_path(local_path)
        candidate = (
            source_root
            / "tools"
            / "esp32-compile-check"
            / "components"
            / component_name
        )
        if candidate.exists():
            return candidate
    return None


def _copy_local_component(
    source: Path, dest: Path, *, dry_run: bool, stub_install: bool
) -> None:
    if dry_run:
        print(f"[yellow]↪︎ DRY-RUN[/] would copy local component {source} -> {dest}")
        return
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(source, dest, ignore=shutil.ignore_patterns(".git"))


def sync_model_dependencies(
    config,
) -> Tuple[List[Tuple[str, str, Optional[str], Path]], List[str]]:
    """
    Synchronize model dependencies from the configuration into the project's dependencies directory.
    
    Collects dependencies used by the model's workloads for the target platform and provisions them into the resolved dependencies directory. Records APT package requirements and handles git repositories and git-source archives, honoring `config.dry_run` and `config.stub_install`, and deduplicating identical (URL/archive, pin) entries.
    
    Parameters:
        config: Configuration object containing at least:
            - model (dict): Model manifest with a "workloads" list.
            - target (str, optional): Platform identifier (defaults to "linux").
            - dry_run (bool, optional): When true, perform no changes.
            - stub_install (bool, optional): When true, create stubs instead of full installs.
    
    Returns:
        Tuple containing:
            - installed (List[Tuple[str, str, Optional[str], Path]]): List of provisioned dependencies as tuples of (name, url_or_archive, pin_or_None, destination Path).
            - apt_packages (List[str]): Sorted list of APT package names required by the model.
    """
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
            local_component = None
            if platform == "esp32":
                local_component = _find_local_esp32_component(config, name)

            if src_type == "git":
                if local_component is not None:
                    print(
                        f"[green]• Copying[/]  {name}  ([dim]{local_component}[/dim])"
                    )
                    _copy_local_component(
                        local_component,
                        dest,
                        dry_run=dry_run,
                        stub_install=stub_install,
                    )
                else:
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
