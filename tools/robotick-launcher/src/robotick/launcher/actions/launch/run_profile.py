import os
from pathlib import Path
import subprocess
import threading
import sys
import time
from typing import Any, Optional
import signal

from rich import print
import typer
import yaml

from robotick.launcher.utils import run_subprocess
from robotick.launcher.actions.query.list import list_project_models
from robotick.launcher.actions.launch import install_deps as install_deps_stage


def stream_output(proc: subprocess.Popen, tag: str):
    for line in iter(proc.stdout.readline, b""):
        sys.stdout.buffer.write(f"[{tag}] ".encode("utf-8") + line)
        sys.stdout.buffer.flush()
    proc.stdout.close()


def _emit_status(status_queue: Optional[Any], **payload):
    if not status_queue:
        return
    message = {"ts": time.time(), **payload}
    try:
        status_queue.put_nowait(message)
    except Exception:
        pass


def _signal_process_group(proc: subprocess.Popen, sig: int) -> None:
    if proc.poll() is not None:
        return

    if hasattr(os, "killpg"):
        try:
            os.killpg(proc.pid, sig)
            return
        except Exception:
            pass

    try:
        proc.send_signal(sig)
    except Exception:
        pass


def _resolve_profile_model_ids(project_path: Path, model_spec: str) -> list[str]:
    if model_spec == "ALL":
        model_paths = list_project_models(project_path)
        return [Path(p).stem.removesuffix(".model") for p in model_paths]

    project_data = yaml.safe_load(project_path.read_text(encoding="utf-8")) or {}
    profiles = project_data.get("profiles") or {}
    if not isinstance(profiles, dict):
        raise ValueError("Project 'profiles' section must be a mapping when provided.")

    profile_entry = profiles.get(model_spec)
    if profile_entry is None:
        return [model_spec]

    if isinstance(profile_entry, list):
        models = profile_entry
    elif isinstance(profile_entry, dict):
        models = profile_entry.get("models") or []
    else:
        raise ValueError(
            f"Profile '{model_spec}' must be a list of model ids or a mapping with 'models'."
        )

    if not isinstance(models, list) or any(not isinstance(model_id, str) or not model_id for model_id in models):
        raise ValueError(
            f"Profile '{model_spec}' must resolve to a list of non-empty model ids."
        )

    return models


def run_profile(
    project: str = typer.Argument(...),
    profile: str = typer.Argument(...),
    base_dir: Path = typer.Option(
        Path.cwd(), help="Base directory containing .launcher"
    ),
    status_queue: Optional[Any] = None,
    *,
    run_after_build: bool = True,
):
    if ":" not in profile:
        return {
            "status": "error",
            "detail": "Invalid profile format (expected 'local:xyz')",
        }

    platform, model_spec = profile.split(":", 1)

    if platform != "local":
        return {
            "status": "unsupported",
            "detail": f"Platform '{platform}' not yet supported",
        }

    project_path = base_dir / f"{project}.project.yaml"
    if not project_path.exists():
        return {
            "status": "error",
            "detail": f"Project file not found: {project_path}",
        }

    base_dir = project_path.parent
    project_name = project_path.stem.removesuffix(".project")

    try:
        model_ids = _resolve_profile_model_ids(project_path, model_spec)
    except Exception as e:
        return {"status": "error", "detail": f"Failed to parse project file: {e}"}

    if not model_ids:
        return {"status": "error", "detail": "No models found to build"}

    _emit_status(
        status_queue,
        event="phase",
        phase="init",
        status="starting",
        profile=profile,
        models=model_ids,
    )

    _emit_status(
        status_queue,
        event="phase",
        phase="build",
        status="starting",
        models=model_ids,
    )

    try:
        install_deps_stage.install_deps(
            project=project_name,
            base_dir=base_dir,
            workspace_root=base_dir,
            model=None,
            target="linux",
        )
    except Exception as exc:
        detail = f"install-deps failed: {exc}"
        print(f"[bold red]❌ {detail}[/]")
        return {"status": "error", "detail": detail}

    max_parallel_env = os.getenv("ROBOTICK_LAUNCHER_MAX_PARALLEL_BUILDS", "").strip()
    max_parallel_builds = len(model_ids)
    if max_parallel_env:
        try:
            max_parallel_builds = int(max_parallel_env)
        except ValueError:
            print(
                "[bold yellow]"
                "⚠️ Invalid ROBOTICK_LAUNCHER_MAX_PARALLEL_BUILDS value "
                f"'{max_parallel_env}', defaulting to {len(model_ids)}"
                "[/]"
            )
            max_parallel_builds = len(model_ids)
    if max_parallel_builds < 1:
        print(
            "[bold yellow]"
            "⚠️ ROBOTICK_LAUNCHER_MAX_PARALLEL_BUILDS must be >= 1, "
            f"defaulting to {len(model_ids)}"
            "[/]"
        )
        max_parallel_builds = len(model_ids)
    max_parallel_builds = min(max_parallel_builds, len(model_ids))

    # --- Build phase (bounded parallelism to avoid CI over-subscription) ---
    print(
        "[Launcher] Building "
        f"{len(model_ids)} models with up to {max_parallel_builds} parallel build(s)..."
    )

    succeeded: list[str] = []
    failed: list[str] = []

    for start in range(0, len(model_ids), max_parallel_builds):
        batch_model_ids = model_ids[start : start + max_parallel_builds]
        build_procs: list[tuple[str, subprocess.Popen]] = []
        build_threads: list[threading.Thread] = []

        for model_id in batch_model_ids:
            build_cmd = [
                "robotick-launcher",
                "build",
                project_name,
                model_id,
                "linux",
                "--base-dir",
                str(base_dir),
                "--workspace-dir",
                str(base_dir),
                "--skip-install-deps",
            ]
            print(f"[Launcher] Building model: {model_id} → {build_cmd}")
            _emit_status(
                status_queue,
                event="model",
                model=model_id,
                stage="build",
                status="starting",
            )
            try:
                proc = run_subprocess(
                    command=build_cmd,
                    wait=False,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                )
                build_procs.append((model_id, proc))
                t = threading.Thread(
                    target=stream_output,
                    args=(proc, f"build:{model_id}"),
                    daemon=True,
                )
                t.start()
                build_threads.append(t)
            except Exception as e:
                failed.append(model_id)
                print(f"[bold red]❌ Exception starting build of {model_id}: {e}[/]")
                _emit_status(
                    status_queue,
                    event="model",
                    model=model_id,
                    stage="build",
                    status="error",
                    detail=f"Failed to start build: {e}",
                )

        # Wait for running builds in this batch
        for model_id, proc in build_procs:
            try:
                rc = proc.wait()
                if rc == 0:
                    succeeded.append(model_id)
                    print(f"[bold green]✅ Build succeeded for {model_id}[/]")
                    _emit_status(
                        status_queue,
                        event="model",
                        model=model_id,
                        stage="build",
                        status="succeeded",
                    )
                else:
                    failed.append(model_id)
                    print(f"[bold red]❌ Build failed for {model_id} (rc={rc})[/]")
                    _emit_status(
                        status_queue,
                        event="model",
                        model=model_id,
                        stage="build",
                        status="failed",
                        returncode=rc,
                    )
            except Exception as e:
                failed.append(model_id)
                print(f"[bold red]⚠️ Error waiting for build {model_id}: {e}[/]")
                _emit_status(
                    status_queue,
                    event="model",
                    model=model_id,
                    stage="build",
                    status="error",
                    detail=str(e),
                )

        # Drain build output threads for this batch
        for t in build_threads:
            t.join()

    # After build loop:
    if failed:
        print(f"[bold red]❌ Build failed for: {', '.join(failed)}[/]")
        print("[Launcher] Aborting run phase — at least one build failed.")
        _emit_status(
            status_queue,
            event="phase",
            phase="build",
            status="failed",
            failed=failed,
        )
        result = {
            "status": "build_failed",
            "detail": f"Build failed for models: {', '.join(failed)}",
            "failed": failed,
        }
        _emit_status(status_queue, event="result", result=result)
        return {
            "status": "build_failed",
            "detail": f"Build failed for models: {', '.join(failed)}",
            "failed": failed,
        }

    # If we get here, all builds succeeded:
    print(f"[Launcher] All builds succeeded. Launching models...")
    _emit_status(
        status_queue,
        event="phase",
        phase="build",
        status="completed",
        models=succeeded,
    )

    if not run_after_build:
        result = {
            "status": "build_completed",
            "built": succeeded,
            "skipped_run": True,
            "failed": failed,
        }
        print("[Launcher] build-profile requested; skipping run phase.")
        _emit_status(
            status_queue,
            event="phase",
            phase="run",
            status="skipped",
            launched=[],
        )
        _emit_status(status_queue, event="result", result=result)
        return result

    print(f"[Launcher] All builds succeeded. Deploying models...")
    _emit_status(
        status_queue,
        event="phase",
        phase="deploy",
        status="starting",
        models=succeeded,
    )

    deployed: list[str] = []
    deploy_failed: list[str] = []
    for model_id in succeeded:
        deploy_cmd = [
            "robotick-launcher",
            "deploy",
            project_name,
            model_id,
            "linux",
            "--base-dir",
            str(base_dir),
        ]
        print(f"[Launcher] Deploying model: {model_id} → {deploy_cmd}")
        _emit_status(
            status_queue,
            event="model",
            model=model_id,
            stage="deploy",
            status="starting",
        )
        try:
            run_subprocess(command=deploy_cmd)
            deployed.append(model_id)
            _emit_status(
                status_queue,
                event="model",
                model=model_id,
                stage="deploy",
                status="succeeded",
            )
        except subprocess.CalledProcessError as e:
            deploy_failed.append(model_id)
            print(f"[bold red]❌ Deploy failed for {model_id} (rc={e.returncode})[/]")
            _emit_status(
                status_queue,
                event="model",
                model=model_id,
                stage="deploy",
                status="failed",
                returncode=e.returncode,
            )
        except Exception as e:
            deploy_failed.append(model_id)
            print(f"[bold red]⚠️ Error during deploy of {model_id}: {e}[/]")
            _emit_status(
                status_queue,
                event="model",
                model=model_id,
                stage="deploy",
                status="error",
                detail=str(e),
            )

    if deploy_failed:
        print(f"[bold red]❌ Deploy failed for: {', '.join(deploy_failed)}[/]")
        print("[Launcher] Aborting run phase — at least one deploy failed.")
        _emit_status(
            status_queue,
            event="phase",
            phase="deploy",
            status="failed",
            failed=deploy_failed,
        )
        result = {
            "status": "deploy_failed",
            "detail": f"Deploy failed for models: {', '.join(deploy_failed)}",
            "failed": deploy_failed,
            "built": succeeded,
        }
        _emit_status(status_queue, event="result", result=result)
        return result

    print(f"[Launcher] All deploys succeeded. Launching models...")
    _emit_status(
        status_queue,
        event="phase",
        phase="deploy",
        status="completed",
        models=deployed,
    )

    run_procs: list[tuple[str, subprocess.Popen]] = []
    run_threads: list[threading.Thread] = []
    launched_models: list[str] = []

    _emit_status(
        status_queue,
        event="phase",
        phase="run",
        status="starting",
        models=deployed,
    )

    for model_id in deployed:
        cmd = [
            "robotick-launcher",
            "run",
            project_name,
            model_id,
            "linux",
            "--base-dir",
            str(base_dir),
            "--workspace-dir",
            str(base_dir),
            "--no-pre",
        ]
        print(f"[Launcher] Running model: {model_id} → {cmd}")
        _emit_status(
            status_queue,
            event="model",
            model=model_id,
            stage="run",
            status="starting",
        )
        try:
            proc = run_subprocess(
                command=cmd,
                wait=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            run_procs.append((model_id, proc))
            launched_models.append(model_id)

            t = threading.Thread(
                target=stream_output,
                args=(proc, f"run:{model_id}"),
                daemon=True,
            )
            t.start()
            run_threads.append(t)
        except Exception as e:
            print(f"[bold red]❌ Failed to launch {model_id}: {e}[/]")
            _emit_status(
                status_queue,
                event="model",
                model=model_id,
                stage="run",
                status="error",
                detail=str(e),
            )

    # Wait for all run processes and output threads
    interrupted = False
    for model_id, proc in run_procs:
        try:
            rc = proc.wait()
            _emit_status(
                status_queue,
                event="model",
                model=model_id,
                stage="run",
                status="succeeded" if rc == 0 else "failed",
                returncode=rc,
            )
            if rc != 0:
                print(f"[bold red]❌ Run process failed for {model_id} (rc={rc})[/]")
        except KeyboardInterrupt:
            interrupted = True
            print("[Launcher] Interrupted; signalling launched models to stop...")
            for _, running_proc in run_procs:
                _signal_process_group(running_proc, signal.SIGINT)
            break
        except Exception as e:
            print(f"[bold red]⚠️ Error waiting for run process: {e}[/]")
            _emit_status(
                status_queue,
                event="model",
                model=model_id,
                stage="run",
                status="error",
                detail=str(e),
            )

    for t in run_threads:
        t.join()

    if interrupted:
        for model_id, proc in run_procs:
            try:
                rc = proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _signal_process_group(proc, signal.SIGTERM)
                rc = proc.wait(timeout=5)
            _emit_status(
                status_queue,
                event="model",
                model=model_id,
                stage="run",
                status="interrupted",
                returncode=rc,
            )

        result = {
            "status": "interrupted",
            "launched": launched_models,
            "count": len(launched_models),
        }
        _emit_status(
            status_queue,
            event="phase",
            phase="run",
            status="interrupted",
            launched=launched_models,
        )
        _emit_status(status_queue, event="result", result=result)
        return result

    result = {
        "status": "ok" if launched_models else "nothing_launched",
        "launched": launched_models,
        "skipped_failed_builds": failed,
        "count": len(launched_models),
    }
    _emit_status(
        status_queue,
        event="phase",
        phase="run",
        status="completed",
        launched=launched_models,
    )
    _emit_status(status_queue, event="result", result=result)
    return result
