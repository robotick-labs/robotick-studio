import ctypes
import filecmp
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from typing import Callable, Optional, Union

import typer
from jinja2 import Environment, FileSystemLoader, TemplateNotFound
from rich import print


# 🔧 Global constants for the launcher folder structure
LAUNCHER_FOLDER = ".launcher"
GENERATED_FOLDER = "generated"


def get_launcher_paths(
    project: str, model: str, target: str, base_dir: Path = Path.cwd()
) -> tuple[Path, Path, Path]:
    """
    Resolves paths for launcher_dir, build_dir, and final binary.

    We normalize dashes to underscores in project/model/target for directory names
    to avoid issues in YAML keys, CMake targets, and file paths.

    However, we preserve the original model name in the binary path — since
    hyphens are safe in filenames and often improve readability.
    """

    project_safe = project.replace("-", "_")
    model_safe = model.replace("-", "_")
    target_safe = target.replace("-", "_")

    project_root = base_dir / LAUNCHER_FOLDER / project_safe
    launcher_dir = project_root / GENERATED_FOLDER / model_safe / target_safe
    build_dir = launcher_dir / "build"
    binary_path = build_dir / model

    if target == "esp32":
        binary_path = binary_path.with_name(binary_path.name + "-esp32.bin")

    return launcher_dir.resolve(), build_dir.resolve(), binary_path.resolve()


# Jinja Template engine: ================================================================================

TEMPLATE_FOLDER = Path(__file__).parent / "actions" / "launch" / "templates"

env = Environment(
    loader=FileSystemLoader(TEMPLATE_FOLDER), trim_blocks=True, lstrip_blocks=True
)


def write_text_if_changed(path: Path, contents: str) -> bool:
    try:
        if path.exists():
            if path.read_text() == contents:
                print(f"[grey]📝 Skipped (no change):[/] {path}")
                return True
            path.write_text(contents)
            print(f"[cyan]📝 Updated:[/] {path}")
            return True

        path.write_text(contents)
        print(f"[green]📝 Created:[/] {path}")
        return True
    except Exception as e:
        print(f"[red]❌ Failed to write:[/] {path} — {e}")
        return False


def render_template(template_name: str, context: dict) -> str:
    """
    Render a Jinja2 template from the template folder with the given context.

    Example:
        render_template("main.cpp", {
            "model": "barr-e-rc",
            "model_safe": "barr_e_rc",
        })
    """
    try:
        template = env.get_template(template_name)
    except TemplateNotFound:
        raise FileNotFoundError(
            f"Template not found: {TEMPLATE_FOLDER / template_name}"
        )

    return template.render(context)


def render_template_to_file(template_name: str, output_path: Path, context: dict):
    contents = render_template(template_name, context)
    write_text_if_changed(output_path, contents)


def copy_extras_for_target(config) -> None:
    """
    Copy templates/extras_<target>/ (recursively) into the model's launcher dir.

    - Source: TEMPLATE_FOLDER / f"extras_{target}"
    - Dest:   config.launcher_dir (or computed via get_launcher_paths if absent)
    - Only overwrites when different (binary compare)
    - Respects config.dry_run
    """
    target = getattr(config, "target", "linux")

    # Resolve launcher_dir (fallback to get_launcher_paths if not provided)
    launcher_dir = getattr(config, "launcher_dir", None)
    if launcher_dir is None:
        project = getattr(config, "project", getattr(config, "project_name", "project"))
        model = getattr(config, "model", getattr(config, "model_name", "model"))
        base_dir = Path(getattr(config, "base_dir", Path.cwd()))
        launcher_dir, _, _ = get_launcher_paths(project, model, target, base_dir)
    else:
        launcher_dir = Path(launcher_dir)

    extras_dir = TEMPLATE_FOLDER / f"extras_{target}"
    if not extras_dir.exists() or not extras_dir.is_dir():
        print(f"[dim]ℹ️ No extras for target '{target}' (looked in {extras_dir})[/]")
        return

    dry_run = bool(getattr(config, "dry_run", False))
    launcher_dir.mkdir(parents=True, exist_ok=True)

    created = updated = skipped = 0

    for src in extras_dir.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(extras_dir)
        dst = launcher_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)

        if dst.exists():
            is_same = filecmp.cmp(src, dst, shallow=False)
            if is_same:
                skipped += 1
                print(f"[grey]📝 Skipped (no change):[/] {dst}")
                continue
            if not dry_run:
                shutil.copy2(src, dst)
            updated += 1
            print(f"[cyan]📝 Updated:[/] {dst}")
        else:
            if not dry_run:
                shutil.copy2(src, dst)
            created += 1
            print(f"[green]📝 Created:[/] {dst}")


def _resolve_command(command: list[str]) -> list[str]:
    if not command:
        return command
    resolved = command.copy()
    executable = shutil.which(resolved[0])
    if executable:
        resolved[0] = executable
        return resolved
    if resolved[0] == "robotick-launcher":
        return [sys.executable, "-m", "robotick.launcher.cli", *resolved[1:]]
    return resolved


def run_subprocess(
    command: list[str],
    cwd: Optional[Path] = None,
    wait: bool = True,
    stdout: Optional[Union[int, object]] = sys.stdout,
    stderr: Optional[Union[int, object]] = sys.stderr,
    env: Optional[dict[str, str]] = None,
    on_interrupt: Optional[Callable[[], None]] = None,
) -> subprocess.Popen:
    command = _resolve_command(command)
    preexec_setup = None
    if sys.platform.startswith("linux"):
        def preexec_setup():
            # Each launcher subprocess gets its own process group so Ctrl-C handling can
            # terminate the whole spawned tree, not just the immediate child.
            os.setsid()

            try:
                libc = ctypes.CDLL("libc.so.6")
                PR_SET_PDEATHSIG = 1
                # If launcher itself disappears unexpectedly, ask the kernel to deliver
                # SIGTERM to the child leader as a best-effort cleanup signal.
                libc.prctl(PR_SET_PDEATHSIG, signal.SIGTERM)
            except Exception as e:
                print(f"[dim red]Warning: Failed to set PDEATHSIG: {e}[/]")

    effective_cwd = str(cwd) if cwd else os.getcwd()
    print(f"[Launcher] Launching in cwd: {effective_cwd}")

    proc = subprocess.Popen(
        command,
        cwd=str(cwd) if cwd else None,
        stdout=stdout,
        stderr=stderr,
        preexec_fn=preexec_setup,
        bufsize=1,
        env=env,
    )

    if wait:
        try:
            proc.wait()
            if proc.returncode != 0:
                raise subprocess.CalledProcessError(proc.returncode, command)
        except KeyboardInterrupt:
            print("[bold red]⛔ Interrupted. Killing subprocess group...[/]")
            killed = False
            if hasattr(os, "killpg") and sys.platform.startswith("linux"):
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                    killed = True
                except Exception as e:
                    print(f"[dim red]killpg failed: {e}[/]")
            if not killed:
                try:
                    proc.kill()
                    killed = True
                except Exception as e:
                    print(f"[dim red]Fallback kill failed: {e}[/]")

            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                print("[dim red]Warning: subprocess did not exit after signal[/]")
            except Exception as e:
                print(f"[dim red]Error while waiting for subprocess termination: {e}[/]")
            if on_interrupt:
                try:
                    # Some targets need explicit follow-up cleanup that a dead local process
                    # group cannot guarantee on its own, for example stopping a remote SSH-run model.
                    on_interrupt()
                except Exception as e:
                    print(f"[dim red]Interrupt cleanup failed: {e}[/]")
            raise typer.Exit(code=1)

    return proc
