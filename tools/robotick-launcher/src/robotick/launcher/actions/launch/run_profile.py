import os
from pathlib import Path
import subprocess
import threading
import sys
import time
from typing import Any, Optional
import signal
from urllib.error import URLError
from urllib.request import urlopen

from rich import print
import typer
import yaml

from robotick.launcher.utils import (
    find_local_process_ids_for_binary,
    get_launcher_paths,
    run_subprocess,
    stop_local_binary_process,
)
from robotick.launcher.actions.query.list import list_project_models
from robotick.launcher.actions.launch import install_deps as install_deps_stage
from robotick.launcher.actions.launch.target_plan import resolve_target_plan
from robotick.launcher.config import Config


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


def _signal_pid_group(pid: int, sig: int) -> None:
    if pid <= 0:
        return
    if hasattr(os, "killpg"):
        try:
            os.killpg(pid, sig)
            return
        except Exception:
            pass
    try:
        os.kill(pid, sig)
    except Exception:
        pass


def _read_proc_children(pid: int) -> list[int]:
    try:
        children = Path(f"/proc/{pid}/task/{pid}/children").read_text().strip()
    except (FileNotFoundError, ProcessLookupError, PermissionError, OSError):
        return []
    if not children:
        return []
    result: list[int] = []
    for child in children.split():
        try:
            result.append(int(child))
        except ValueError:
            continue
    return result


def _collect_descendant_pids(pid: int) -> list[int]:
    descendants: list[int] = []
    seen: set[int] = set()
    stack = [pid]
    while stack:
        current = stack.pop()
        for child in _read_proc_children(current):
            if child in seen:
                continue
            seen.add(child)
            descendants.append(child)
            stack.append(child)
    return descendants


def _pid_is_active(pid: int) -> bool:
    try:
        stat_fields = Path(f"/proc/{pid}/stat").read_text().split()
    except (FileNotFoundError, ProcessLookupError, PermissionError, OSError):
        return False

    if len(stat_fields) < 3:
        return False

    return stat_fields[2] != "Z"


def _stop_local_launcher_helper(pid: int) -> None:
    if pid <= 0:
        return

    targets = [*reversed(_collect_descendant_pids(pid)), pid]
    for target_pid in targets:
        _signal_pid_group(target_pid, signal.SIGTERM)
    deadline = time.time() + 0.5
    while time.time() < deadline:
        all_gone = True
        for target_pid in targets:
            if _pid_is_active(target_pid):
                all_gone = False
                break
        if all_gone:
            return
        time.sleep(0.1)

    for target_pid in targets:
        _signal_pid_group(target_pid, signal.SIGKILL)


def _resolve_model_health_url(
    project_name: str,
    model_id: str,
    model_target: str,
    base_dir: Path,
    profile_platform: str,
) -> Optional[str]:
    if profile_platform != "local":
        return None

    config = Config(
        project_name,
        model_id,
        model_target,
        base_dir,
        dry_run=False,
        stub_install=False,
    )
    telemetry = dict(config.model.get("telemetry") or {})
    port = telemetry.get("port")
    if not isinstance(port, int) or port <= 0:
        return None

    runtime = dict(config.model.get("runtime") or {})
    host = str(runtime.get("preferred_host") or "localhost").strip() or "localhost"
    if host not in {"localhost", "127.0.0.1"}:
        return None

    return f"http://{host}:{port}/api/telemetry/health"


def _health_ready(url: str, *, timeout: float = 0.2) -> bool:
    try:
        with urlopen(url, timeout=timeout) as response:
            return response.status == 200
    except (OSError, URLError):
        return False


def _emit_models_running(
    launched_models: list[str],
    run_proc_map: dict[str, subprocess.Popen],
    ready_models: set[str],
    status_queue: Optional[Any],
) -> None:
    for model_id in launched_models:
        if model_id in ready_models:
            continue
        proc = run_proc_map.get(model_id)
        if proc is None or proc.poll() is not None:
            continue
        ready_models.add(model_id)
        _emit_status(
            status_queue,
            event="model",
            model=model_id,
            stage="run",
            status="running",
            pid=proc.pid,
        )


def _wait_for_run_readiness(
    launched_models: list[str],
    run_proc_map: dict[str, subprocess.Popen],
    model_health_urls: dict[str, Optional[str]],
    status_queue: Optional[Any],
    *,
    timeout_seconds: float = 15.0,
) -> list[str]:
    ready_models: set[str] = set()
    deadline = time.monotonic() + timeout_seconds

    while time.monotonic() < deadline and len(ready_models) < len(launched_models):
        for model_id in launched_models:
            if model_id in ready_models:
                continue
            proc = run_proc_map.get(model_id)
            if proc is None or proc.poll() is not None:
                continue
            health_url = model_health_urls.get(model_id)
            if health_url is None or _health_ready(health_url):
                ready_models.add(model_id)
                _emit_status(
                    status_queue,
                    event="model",
                    model=model_id,
                    stage="run",
                    status="running",
                    pid=proc.pid,
                )
        if len(ready_models) < len(launched_models):
            time.sleep(0.1)

    _emit_models_running(launched_models, run_proc_map, ready_models, status_queue)
    return [model_id for model_id in launched_models if model_id in ready_models]


def _local_deploy_can_complete_immediately(plan: Any) -> bool:
    return plan.deploy.strategy == "local" and plan.deploy.deploy_handler is None


def _normalize_model_id(model_spec: str) -> str:
    model_name = Path(model_spec).name
    if model_name.endswith(".model.yaml"):
        return Path(model_name).stem.removesuffix(".model")
    return model_spec


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
        return [_normalize_model_id(model_spec)]

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


def _resolve_profile_model_target(
    project_name: str,
    base_dir: Path,
    profile_platform: str,
    model_id: str,
) -> str:
    if profile_platform == "local":
        return "linux"

    config = Config(
        project_name,
        model_id,
        None,
        base_dir,
        dry_run=False,
        stub_install=False,
    )
    runtime = dict(config.model.get("runtime") or {})
    return str(runtime.get("target_platform") or "linux").strip().lower() or "linux"


def stop_profile(
    project: str,
    profile: str,
    base_dir: Path,
    *,
    dry_run: bool = False,
    helper_pids: Optional[dict[str, int]] = None,
) -> dict[str, object]:
    if ":" not in profile:
        return {
            "status": "error",
            "detail": "Invalid profile format (expected 'local:xyz' or 'native:xyz')",
        }

    platform, model_spec = profile.split(":", 1)
    if platform not in {"local", "native"}:
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
        model_targets = {
            model_id: _resolve_profile_model_target(
                project_name, base_dir, platform, model_id
            )
            for model_id in model_ids
        }
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}

    stopped_models: list[str] = []
    errors: list[str] = []
    results_lock = threading.Lock()

    def _record_success(model_id: str) -> None:
        with results_lock:
            stopped_models.append(model_id)

    def _record_error(model_id: str, exc: Exception) -> None:
        with results_lock:
            errors.append(f"{model_id}: {exc}")

    def _stop_one_local_model(
        model_id: str,
        binary_path: Path,
        helper_pid: Optional[int],
    ) -> None:
        try:
            if helper_pid:
                if dry_run:
                    print(
                        f"[bold]$ stop launcher helper pid for {model_id}: {helper_pid}[/]"
                    )
                else:
                    _stop_local_launcher_helper(helper_pid)
                stop_local_binary_process(binary_path, dry_run=dry_run)
            else:
                stop_local_binary_process(binary_path, dry_run=dry_run)
            _record_success(model_id)
        except Exception as exc:
            _record_error(model_id, exc)

    local_stop_threads: list[threading.Thread] = []

    for model_id in reversed(model_ids):
        model_target = model_targets[model_id]
        try:
            _, _, binary_path = get_launcher_paths(
                project_name, model_id, model_target, base_dir
            )
            plan = resolve_target_plan(project_name, model_id, model_target, base_dir)
            if plan.run.stop_handler is not None:
                plan.run.stop_handler(dry_run)
                _record_success(model_id)
                continue

            if plan.run.strategy == "local":
                helper_pid = helper_pids.get(model_id) if helper_pids else None
                thread = threading.Thread(
                    target=_stop_one_local_model,
                    args=(model_id, binary_path, helper_pid),
                    daemon=True,
                )
                thread.start()
                local_stop_threads.append(thread)
                continue

            _record_success(model_id)
        except Exception as exc:
            _record_error(model_id, exc)

    for thread in local_stop_threads:
        thread.join()

    if errors:
        return {
            "status": "error",
            "detail": "; ".join(errors),
            "stopped": stopped_models,
        }

    return {"status": "stopped", "stopped": stopped_models}


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
            "detail": "Invalid profile format (expected 'local:xyz' or 'native:xyz')",
        }

    platform, model_spec = profile.split(":", 1)

    if platform not in {"local", "native"}:
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

    try:
        model_targets = {
            model_id: _resolve_profile_model_target(project_name, base_dir, platform, model_id)
            for model_id in model_ids
        }
    except Exception as e:
        return {"status": "error", "detail": f"Failed to resolve model targets: {e}"}

    try:
        model_plans = {
            model_id: resolve_target_plan(
                project_name,
                model_id,
                model_targets[model_id],
                base_dir,
            )
            for model_id in model_ids
        }
    except Exception as e:
        return {"status": "error", "detail": f"Failed to resolve target plans: {e}"}

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

    for target in dict.fromkeys(model_targets.values()):
        try:
            install_deps_stage.install_deps(
                project=project_name,
                base_dir=base_dir,
                workspace_root=base_dir,
                model=None,
                target=target,
            )
        except Exception as exc:
            detail = f"install-deps failed for target '{target}': {exc}"
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
            model_target = model_targets[model_id]
            build_cmd = [
                "robotick-launcher",
                "build",
                project_name,
                model_id,
                model_target,
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

    print(f"[Launcher] Deploying {len(succeeded)} models with shared deploy dedupe...")

    deployed: list[str] = []
    deploy_failed: list[str] = []
    deploy_jobs: list[tuple[str, list[str], Optional[tuple[str, ...]]]] = []
    shared_job_members: dict[tuple[str, ...], list[str]] = {}
    for model_id in succeeded:
        plan = model_plans[model_id]
        shared_deploy_key = plan.deploy.shared_deploy_key
        if shared_deploy_key is None:
            deploy_jobs.append((model_id, [model_id], None))
            continue
        members = shared_job_members.setdefault(shared_deploy_key, [])
        members.append(model_id)
        if len(members) == 1:
            deploy_jobs.append((model_id, members, shared_deploy_key))

    deploy_procs: list[
        tuple[str, list[str], Optional[tuple[str, ...]], list[str], subprocess.Popen, threading.Thread]
    ] = []

    for leader_model_id, job_models, shared_deploy_key in deploy_jobs:
        model_target = model_targets[leader_model_id]
        plan = model_plans[leader_model_id]
        for model_id in job_models:
            _emit_status(
                status_queue,
                event="model",
                model=model_id,
                stage="deploy",
                status="starting",
                shared=shared_deploy_key is not None and model_id != leader_model_id,
            )

        if _local_deploy_can_complete_immediately(plan):
            _, _, binary_path = get_launcher_paths(
                project_name, leader_model_id, model_target, base_dir
            )
            if binary_path.exists():
                for model_id in job_models:
                    deployed.append(model_id)
                    _emit_status(
                        status_queue,
                        event="model",
                        model=model_id,
                        stage="deploy",
                        status="succeeded",
                        shared=shared_deploy_key is not None and model_id != leader_model_id,
                    )
                continue

            detail = f"Binary not found: {binary_path}"
            for model_id in job_models:
                deploy_failed.append(model_id)
                _emit_status(
                    status_queue,
                    event="model",
                    model=model_id,
                    stage="deploy",
                    status="failed",
                    detail=detail,
                    shared=shared_deploy_key is not None and model_id != leader_model_id,
                )
            print(f"[bold red]❌ Deploy failed for {leader_model_id}: {detail}[/]")
            continue

        deploy_cmd = [
            "robotick-launcher",
            "deploy",
            project_name,
            leader_model_id,
            model_target,
            "--base-dir",
            str(base_dir),
            "--no-pre",
        ]
        print(f"[Launcher] Deploying model: {leader_model_id} → {deploy_cmd}")
        try:
            proc = run_subprocess(
                command=deploy_cmd,
                wait=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )
            deploy_thread = threading.Thread(
                target=stream_output,
                args=(proc, f"deploy:{leader_model_id}"),
                daemon=True,
            )
            deploy_thread.start()
            deploy_procs.append(
                (
                    leader_model_id,
                    list(job_models),
                    shared_deploy_key,
                    deploy_cmd,
                    proc,
                    deploy_thread,
                )
            )
        except Exception as e:
            detail = str(e)
            print(f"[bold red]❌ Failed to start deploy for {leader_model_id}: {detail}[/]")
            for model_id in job_models:
                deploy_failed.append(model_id)
                _emit_status(
                    status_queue,
                    event="model",
                    model=model_id,
                    stage="deploy",
                    status="error",
                    detail=detail,
                    shared=shared_deploy_key is not None and model_id != leader_model_id,
                )

    for leader_model_id, job_models, shared_deploy_key, deploy_cmd, proc, deploy_thread in deploy_procs:
        try:
            rc = proc.wait()
            deploy_thread.join()
            if rc != 0:
                raise subprocess.CalledProcessError(rc, deploy_cmd)
            for model_id in job_models:
                deployed.append(model_id)
                _emit_status(
                    status_queue,
                    event="model",
                    model=model_id,
                    stage="deploy",
                    status="succeeded",
                    shared=shared_deploy_key is not None and model_id != leader_model_id,
                )
        except subprocess.CalledProcessError as e:
            detail = f"returncode={e.returncode}"
            print(f"[bold red]❌ Deploy failed for {leader_model_id} (rc={e.returncode})[/]")
            for model_id in job_models:
                deploy_failed.append(model_id)
                _emit_status(
                    status_queue,
                    event="model",
                    model=model_id,
                    stage="deploy",
                    status="failed",
                    returncode=e.returncode,
                    detail=detail,
                    shared=shared_deploy_key is not None and model_id != leader_model_id,
                )
        except Exception as e:
            detail = str(e)
            print(f"[bold red]⚠️ Error during deploy of {leader_model_id}: {detail}[/]")
            for model_id in job_models:
                deploy_failed.append(model_id)
                _emit_status(
                    status_queue,
                    event="model",
                    model=model_id,
                    stage="deploy",
                    status="error",
                    detail=detail,
                    shared=shared_deploy_key is not None and model_id != leader_model_id,
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
    model_health_urls: dict[str, Optional[str]] = {}

    _emit_status(
        status_queue,
        event="phase",
        phase="run",
        status="starting",
        models=deployed,
    )

    for model_id in deployed:
        model_target = model_targets[model_id]
        cmd = [
            "robotick-launcher",
            "run",
            project_name,
            model_id,
            model_target,
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
            model_health_urls[model_id] = _resolve_model_health_url(
                project_name,
                model_id,
                model_target,
                base_dir,
                platform,
            )
            _emit_status(
                status_queue,
                event="model",
                model=model_id,
                stage="run",
                status="starting",
                pid=proc.pid,
            )

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

    run_proc_map = {model_id: proc for model_id, proc in run_procs}
    ready_models = _wait_for_run_readiness(
        launched_models,
        run_proc_map,
        model_health_urls,
        status_queue,
    )
    if ready_models:
        _emit_status(
            status_queue,
            event="phase",
            phase="run",
            status="in_progress",
            launched=ready_models,
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
