import asyncio
import contextlib
import copy
from datetime import datetime
import multiprocessing as mp
import queue as queue_module
from pathlib import Path
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from rich import print

from robotick.launcher.actions.launch import run_profile as run_profile_module

router = APIRouter(prefix="/launcher", tags=["launcher"])

# ANSI escape sequences
ANSI_RESET = "\x1b[0m"
ANSI_BOLD_YELLOW = "\x1b[1;33m"
ANSI_DIM_CYAN = "\x1b[2;36m"

_mp_ctx = mp.get_context("spawn")

process_handle: Optional[mp.Process] = None
status_queue: Optional[mp.Queue] = None
status_thread: Optional[threading.Thread] = None
stop_thread: Optional[threading.Thread] = None
current_profile: Optional[str] = None
current_project_path: Optional[Path] = None
current_run_started_at: Optional[float] = None
log_loop: Optional[asyncio.AbstractEventLoop] = None

log_subscribers: List[asyncio.Queue] = []
log_lock = threading.Lock()

status_lock = threading.Lock()
lifecycle_lock = threading.Lock()
current_status: Dict[str, Any] = {
    "status": "stopped",
    "phase": None,
    "profile": None,
    "models": {},
}


class _QueueStream:
    """Pipe stdout/stderr from the worker process back to listeners via the status queue."""

    def __init__(self, queue: mp.Queue, passthrough, stream_label: str):
        self.queue = queue
        self.passthrough = passthrough
        self.stream_label = stream_label
        self._buffer = ""
        self.buffer = self  # mimic TextIOBase.buffer so callers can write bytes
        self.encoding = getattr(passthrough, "encoding", "utf-8")

    def write(self, data: str):
        if not data:
            return 0
        if isinstance(data, bytes):
            text = data.decode(self.encoding or "utf-8", errors="replace")
        else:
            text = str(data)
        self.passthrough.write(text)
        self.passthrough.flush()
        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self.queue.put({"event": "log", "line": line, "stream": self.stream_label})
        return len(text)

    def flush(self):
        self.passthrough.flush()

    def close(self):
        if self._buffer:
            self.queue.put(
                {"event": "log", "line": self._buffer, "stream": self.stream_label}
            )
            self._buffer = ""


class _BroadcastStream:
    """Mirror listener-thread output to websocket log subscribers line by line."""

    def __init__(self, passthrough):
        self.passthrough = passthrough
        self._buffer = ""
        self._lock = threading.Lock()
        self.buffer = self
        self.encoding = getattr(passthrough, "encoding", "utf-8")

    def write(self, data: str):
        if not data:
            return 0
        with self._lock:
            if isinstance(data, bytes):
                text = data.decode(self.encoding or "utf-8", errors="replace")
            else:
                text = str(data)
            self.passthrough.write(text)
            self.passthrough.flush()
            self._buffer += text
            loop = log_loop
            while "\n" in self._buffer:
                line, self._buffer = self._buffer.split("\n", 1)
                if loop is not None:
                    _broadcast_log(line, loop)
        return len(text)

    def flush(self):
        self.passthrough.flush()

    def close(self):
        with self._lock:
            if self._buffer:
                loop = log_loop
                if loop is not None:
                    _broadcast_log(self._buffer, loop)
                self._buffer = ""


def _set_initial_status(profile: str):
    with status_lock:
        current_status.clear()
        current_status.update(
            {
                "status": "launching",
                "phase": None,
                "profile": profile,
                "models": {},
            }
        )


def _set_stopped_status() -> None:
    with status_lock:
        current_status.clear()
        current_status.update(
            {
                "status": "stopped",
                "phase": None,
                "profile": None,
                "models": {},
            }
        )


def _set_stopping_status() -> None:
    with status_lock:
        current_status["status"] = "stopping"
        current_status["phase"] = "stop"


def _format_elapsed_since_run_start() -> str:
    if current_run_started_at is None:
        return "00:00:00.000"

    elapsed_seconds = max(0.0, time.monotonic() - current_run_started_at)
    total_milliseconds = round(elapsed_seconds * 1000)
    hours, remainder = divmod(total_milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def _apply_status_event(message: Dict[str, Any]):
    event = message.get("event")
    if event == "phase":
        phase = message.get("phase")
        phase_status = message.get("status")
        with status_lock:
            is_stopping = current_status.get("status") == "stopping"
            if is_stopping and phase_status not in ("failed", "error"):
                return
            current_status["phase"] = phase
            if phase == "run" and phase_status in ("in_progress", "ready"):
                current_status["status"] = "running"
            elif phase_status in ("completed", "ok"):
                if phase == "run":
                    current_status["status"] = "completed"
                elif current_status.get("status") not in ("running", "completed"):
                    current_status["status"] = "launching"
            elif phase_status in ("failed", "error"):
                current_status["status"] = "error"
                if message.get("detail"):
                    current_status["detail"] = message["detail"]
                if message.get("failed"):
                    current_status["failed"] = message["failed"]
            else:
                if current_status.get("status") not in ("running",):
                    current_status["status"] = "launching"
    elif event == "model":
        model_id = message.get("model")
        if not model_id:
            return
        with status_lock:
            model_entry = current_status.setdefault("models", {}).setdefault(
                model_id, {}
            )
            model_entry.update(
                {
                    "stage": message.get("stage"),
                    "status": message.get("status"),
                }
            )
            if "returncode" in message:
                model_entry["returncode"] = message["returncode"]
            if "pid" in message:
                model_entry["pid"] = message["pid"]
            if "shared" in message:
                model_entry["shared"] = message["shared"]
            if message.get("detail"):
                model_entry["detail"] = message["detail"]
    elif event == "result":
        with status_lock:
            if current_status.get("status") == "stopping":
                return
            current_status["result"] = message.get("result")
            if current_status.get("status") not in ("error",):
                current_status["status"] = message.get("result", {}).get(
                    "status", "completed"
                )
    elif event == "error":
        with status_lock:
            if current_status.get("status") == "stopping":
                return
            current_status["status"] = "error"
            current_status["detail"] = message.get("detail")


def _broadcast_log(line: str, loop: asyncio.AbstractEventLoop):
    if not line:
        return
    tag = current_profile or "profile"
    now = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    elapsed = _format_elapsed_since_run_start()
    msg = f"{ANSI_BOLD_YELLOW}{now}{ANSI_RESET} | {ANSI_DIM_CYAN}{elapsed}{ANSI_RESET} [{tag}] {line}"

    with log_lock:
        for queue in log_subscribers:
            loop.call_soon_threadsafe(queue.put_nowait, msg)


def _close_log_subscribers():
    with log_lock:
        subscribers = list(log_subscribers)
    for subscriber in subscribers:
        try:
            subscriber.put_nowait(None)
        except Exception as exc:
            print(
                f"[Launcher] Runtime health probe failed for '{model_id}'"
                f" ({platform}, {project_path}): {exc}"
            )


def _status_consumer(loop: asyncio.AbstractEventLoop):
    global process_handle, status_queue, status_thread, current_profile, current_project_path, current_run_started_at, log_loop

    while True:
        if status_queue is None:
            break
        try:
            message = status_queue.get(timeout=0.5)
        except queue_module.Empty:
            if process_handle and process_handle.is_alive():
                continue
            break

        if message is None:
            break

        event = message.get("event")
        if event == "log":
            _broadcast_log(message.get("line", ""), loop)
            continue

        if event == "done":
            break

        _apply_status_event(message)

    proc_to_join: Optional[mp.Process] = None
    queue_to_close: Optional[mp.Queue] = None
    with lifecycle_lock:
        if process_handle:
            proc_to_join = process_handle
        process_handle = None
        if status_queue:
            queue_to_close = status_queue
        status_queue = None
        log_loop = None
        current_profile = None
        current_project_path = None
        current_run_started_at = None
        status_thread = None

    if proc_to_join:
        proc_to_join.join(timeout=1)
    if queue_to_close:
        queue_to_close.close()

    if current_status.get("status") not in ("error", "completed", "stopping"):
        _set_stopped_status()

def _tracked_helper_pids() -> dict[str, int]:
    with status_lock:
        models = copy.deepcopy(current_status.get("models") or {})
    helper_pids: dict[str, int] = {}
    for model_id, entry in models.items():
        pid = entry.get("pid")
        if isinstance(pid, int) and pid > 0:
            helper_pids[model_id] = pid
    return helper_pids


def _normalize_platform(platform: str) -> Optional[str]:
    normalized = platform.strip().lower()
    if normalized in {"local", "native"}:
        return normalized
    return None


def _active_platform() -> str:
    profile = current_profile or ""
    if ":" not in profile:
        return "local"
    platform, _ = profile.split(":", 1)
    normalized = _normalize_platform(platform)
    return normalized or "local"


def _set_model_run_status(
    model_id: str,
    status: str,
    *,
    detail: Optional[str] = None,
    returncode: Optional[int] = None,
    pid: Optional[int] = None,
    shared: Optional[bool] = None,
) -> None:
    with status_lock:
        model_entry = current_status.setdefault("models", {}).setdefault(model_id, {})
        model_entry.update({"stage": "run", "status": status})
        if detail is not None:
            model_entry["detail"] = detail
        if returncode is not None:
            model_entry["returncode"] = returncode
        if pid is not None:
            model_entry["pid"] = pid
        if shared is not None:
            model_entry["shared"] = shared
        if status in {"starting", "running"}:
            current_status["status"] = "running"
            current_status["phase"] = "run"


def _is_model_runtime_healthy(project_path: Path, platform: str, model_id: str) -> bool:
    if platform != "local":
        return False
    project_name = project_path.name.removesuffix(".project.yaml")
    base_dir = project_path.parent
    model_target = run_profile_module._resolve_profile_model_target(
        project_name, base_dir, platform, model_id
    )
    health_url = run_profile_module._resolve_model_health_url(
        project_name, model_id, model_target, base_dir, platform
    )
    return bool(health_url and run_profile_module._health_ready(health_url))


def _run_single_model_worker(
    project_path: Path,
    platform: str,
    model_id: str,
) -> None:
    global current_profile, current_project_path, current_run_started_at

    project_name = project_path.name.removesuffix(".project.yaml")
    base_dir = project_path.parent

    try:
        model_target = run_profile_module._resolve_profile_model_target(
            project_name, base_dir, platform, model_id
        )
    except Exception as exc:
        _set_model_run_status(model_id, "error", detail=str(exc))
        return

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
    ]

    _set_model_run_status(model_id, "starting")

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except Exception as exc:
        _set_model_run_status(model_id, "error", detail=str(exc))
        return

    _set_model_run_status(model_id, "running", pid=proc.pid)

    loop = log_loop
    if proc.stdout:
        for line in proc.stdout:
            stripped = line.rstrip("\n")
            if not stripped:
                continue
            if loop is not None:
                _broadcast_log(stripped, loop)
            else:
                print(stripped)

    rc = proc.wait()
    # The launcher helper can return non-zero while the model is still up
    # (e.g. duplicate run/container conflict). Prefer runtime health.
    if rc != 0:
        try:
            if _is_model_runtime_healthy(project_path, platform, model_id):
                _set_model_run_status(
                    model_id, "running", returncode=rc, pid=proc.pid, shared=True
                )
                return
        except Exception:
            pass

    _set_model_run_status(
        model_id,
        "succeeded" if rc == 0 else "failed",
        returncode=rc,
    )

    should_reset_to_stopped = False
    with lifecycle_lock:
        managed_process_active = process_handle is not None and process_handle.is_alive()
        if not managed_process_active and current_profile == f"{platform}:{model_id}":
            current_profile = None
            current_project_path = None
            current_run_started_at = None
            should_reset_to_stopped = True

    if should_reset_to_stopped:
        _set_stopped_status()


def _stop_launcher_worker() -> None:
    global process_handle, status_queue, status_thread, stop_thread, current_profile, current_project_path, current_run_started_at, log_loop

    with lifecycle_lock:
        proc = process_handle
        queue = status_queue
        thread = status_thread
        profile = current_profile
        project_path = current_project_path
        helper_pids = _tracked_helper_pids()
        process_handle = None
        status_queue = None
        status_thread = None

    if profile and project_path:
        stdout = _BroadcastStream(sys.__stdout__)
        stderr = _BroadcastStream(sys.__stderr__)
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            try:
                stop_started_at = time.monotonic()
                run_profile_module.stop_profile(
                    project=project_path.name.removesuffix(".project.yaml"),
                    profile=profile,
                    base_dir=project_path.parent,
                    helper_pids=helper_pids,
                )
                stop_elapsed = time.monotonic() - stop_started_at
                print(f"[stop:/] model stop completed in {stop_elapsed:.3f}s")
            except Exception as exc:
                print(f"[Launcher] Best-effort profile stop failed: {exc}")
            finally:
                stdout.close()
                stderr.close()

    if proc and proc.is_alive():
        reap_started_at = time.monotonic()
        proc.terminate()
        proc.join(timeout=0.25)
        if proc.is_alive():
            proc.kill()
            proc.join(timeout=0.25)
        print(
            f"[stop:/] launcher worker cleanup completed in {time.monotonic() - reap_started_at:.3f}s"
        )

    if queue:
        try:
            queue.put_nowait(None)
        except Exception:
            pass
        finally:
            queue.close()

    if thread and thread.is_alive():
        thread.join(timeout=1)

    _close_log_subscribers()
    _set_stopped_status()

    with lifecycle_lock:
        current_profile = None
        current_project_path = None
        current_run_started_at = None
        log_loop = None
        stop_thread = None


def _run_profile_worker(
    project_name: str,
    profile: str,
    base_dir_str: str,
    queue: mp.Queue,
):
    base_dir = Path(base_dir_str)
    stdout = _QueueStream(queue, sys.__stdout__, "stdout")
    stderr = _QueueStream(queue, sys.__stderr__, "stderr")

    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
        try:
            run_profile_module.run_profile(
                project_name, profile, base_dir, status_queue=queue
            )
        except Exception as exc:
            queue.put({"event": "error", "detail": str(exc)})
            raise
        finally:
            stdout.close()
            stderr.close()
            queue.put({"event": "done"})


@router.websocket("/ws/log")
async def launcher_log_stream(websocket: WebSocket):
    await websocket.accept()
    queue = asyncio.Queue()

    with log_lock:
        log_subscribers.append(queue)
    print("[WebSocket] Connected")

    try:
        while True:
            line = await queue.get()
            if line is None:
                break
            await websocket.send_text(line)
    except WebSocketDisconnect:
        print("[WebSocket] Client disconnected")
    finally:
        with log_lock:
            if queue in log_subscribers:
                log_subscribers.remove(queue)
        print("[WebSocket] Closed")


@router.post("/run-model")
async def run_model(
    project_path: Path = Query(
        ..., description="Absolute path to the project YAML file"
    ),
    model_id: str = Query(..., description="Model id / short name to launch"),
    platform: str = Query(
        "local", description="Launch platform prefix: local or native"
    ),
):
    global current_profile, current_project_path, current_run_started_at

    normalized_platform = _normalize_platform(platform)
    if normalized_platform is None:
        return {
            "status": "error",
            "detail": f"Invalid platform '{platform}' (expected local or native)",
        }

    trimmed_model_id = model_id.strip()
    if not trimmed_model_id:
        return {
            "status": "error",
            "detail": "model_id must be a non-empty string",
        }

    with lifecycle_lock:
        if stop_thread and stop_thread.is_alive():
            return {"status": "stopping"}
        if current_project_path is None:
            current_project_path = project_path
        if current_profile is None:
            current_profile = f"{normalized_platform}:{trimmed_model_id}"
            current_run_started_at = time.monotonic()

    with status_lock:
        current_status["profile"] = current_profile
        model_entry = current_status.setdefault("models", {}).get(trimmed_model_id) or {}
        if model_entry.get("stage") == "run" and model_entry.get("status") in {
            "starting",
            "running",
        }:
            return {
                "status": "already running",
                "model": trimmed_model_id,
            }
        current_status["status"] = "running"
        current_status["phase"] = "run"

    # If runtime is already healthy, don't spawn another launcher helper.
    try:
        if _is_model_runtime_healthy(project_path, normalized_platform, trimmed_model_id):
            _set_model_run_status(trimmed_model_id, "running", shared=True)
            return {
                "status": "already running",
                "model": trimmed_model_id,
            }
    except Exception as exc:
        print(
            f"[Launcher] Runtime preflight health probe failed for "
            f"'{trimmed_model_id}' ({normalized_platform}, {project_path}): {exc}"
        )

    worker = threading.Thread(
        target=_run_single_model_worker,
        args=(project_path, normalized_platform, trimmed_model_id),
        daemon=True,
    )
    worker.start()

    return {
        "status": "launching",
        "model": trimmed_model_id,
        "profile": f"{normalized_platform}:{trimmed_model_id}",
    }


@router.post("/stop-model")
async def stop_model(
    model_id: str = Query(..., description="Model id / short name to stop"),
    project_path: Optional[Path] = Query(
        None, description="Absolute path to the project YAML file"
    ),
    platform: Optional[str] = Query(
        None, description="Optional platform prefix override (local/native)"
    ),
):
    global current_profile, current_project_path, current_run_started_at

    trimmed_model_id = model_id.strip()
    if not trimmed_model_id:
        return {
            "status": "error",
            "detail": "model_id must be a non-empty string",
        }

    normalized_platform = (
        _normalize_platform(platform) if platform is not None else _active_platform()
    )
    if normalized_platform is None:
        return {
            "status": "error",
            "detail": f"Invalid platform '{platform}' (expected local or native)",
        }

    with lifecycle_lock:
        effective_project_path = project_path or current_project_path

    if effective_project_path is None:
        return {
            "status": "error",
            "detail": "No active project to stop model from.",
        }

    helper_pid = _tracked_helper_pids().get(trimmed_model_id)
    helper_pids = {trimmed_model_id: helper_pid} if helper_pid else None

    try:
        stop_result = run_profile_module.stop_profile(
            project=effective_project_path.name.removesuffix(".project.yaml"),
            profile=f"{normalized_platform}:{trimmed_model_id}",
            base_dir=effective_project_path.parent,
            helper_pids=helper_pids,
        )
    except Exception as exc:
        stop_result = {"status": "error", "detail": str(exc)}

    if stop_result.get("status") == "error":
        _set_model_run_status(
            trimmed_model_id,
            "error",
            detail=str(stop_result.get("detail") or "stop failed"),
        )
    else:
        _set_model_run_status(trimmed_model_id, "stopped")

    should_reset_to_stopped = False
    with lifecycle_lock:
        managed_process_active = process_handle is not None and process_handle.is_alive()
        if (
            not managed_process_active
            and current_profile == f"{normalized_platform}:{trimmed_model_id}"
        ):
            current_profile = None
            current_project_path = None
            current_run_started_at = None
            should_reset_to_stopped = True

    if should_reset_to_stopped:
        _set_stopped_status()

    return stop_result


@router.post("/run")
async def run_launcher(
    project_path: Path = Query(
        ..., description="Absolute path to the project YAML file"
    ),
    profile: str = Query(
        ..., description="Launcher profile string, e.g. 'local:model-id' or 'native:model-id'"
    ),
):
    global process_handle, status_queue, status_thread, stop_thread, current_profile, current_project_path, current_run_started_at, log_loop

    print(f"[Launcher] Requested run: {project_path=} | {profile=}")

    with lifecycle_lock:
        if stop_thread and stop_thread.is_alive():
            return {"status": "stopping"}
        if process_handle and process_handle.is_alive():
            return {"status": "already running"}

    if ":" not in profile:
        return {
            "status": "error",
            "detail": "Invalid profile format (expected 'local:model-id' or 'native:model-id')",
        }

    base_dir = project_path.parent
    project_name = project_path.name.removesuffix(".project.yaml")

    _set_initial_status(profile)
    current_profile = profile
    current_project_path = project_path
    current_run_started_at = time.monotonic()

    proc: Optional[mp.Process] = None
    try:
        with lifecycle_lock:
            status_queue = _mp_ctx.Queue()
            process_handle = _mp_ctx.Process(
                target=_run_profile_worker,
                args=(project_name, profile, str(base_dir), status_queue),
                daemon=True,
            )
            proc = process_handle
        proc.start()
    except Exception as exc:
        queue_to_close: Optional[mp.Queue] = None
        with lifecycle_lock:
            queue_to_close = status_queue
            process_handle = None
            status_queue = None
        if queue_to_close:
            try:
                queue_to_close.close()
                queue_to_close.join_thread()
            except Exception as queue_exc:  # pragma: no cover - best-effort cleanup
                print(f"[Launcher] Failed to close status queue cleanly: {queue_exc}")
        current_profile = None
        current_project_path = None
        current_run_started_at = None
        with status_lock:
            current_status["status"] = "error"
            current_status["detail"] = str(exc)
        return {
            "status": "error",
            "detail": f"Failed to launch profile '{profile}': {exc}",
        }

    loop = asyncio.get_running_loop()
    log_loop = loop

    status_thread = threading.Thread(
        target=_status_consumer,
        args=(loop,),
        daemon=True,
    )
    status_thread.start()

    return {
        "status": "launching",
        "model": profile,
        "project": project_name,
    }


@router.post("/stop")
async def stop_launcher():
    global stop_thread

    print("[Launcher] Requested stop")

    with lifecycle_lock:
        if stop_thread and stop_thread.is_alive():
            return {"status": "stopping"}

        with status_lock:
            already_stopped = current_status.get("status") == "stopped"
        if already_stopped and not process_handle:
            _set_stopped_status()
            return {"status": "stopped"}

        _set_stopping_status()
        stop_thread = threading.Thread(
            target=_stop_launcher_worker,
            daemon=True,
        )
        stop_thread.start()

    return {"status": "stopping"}


@router.get("/status")
def get_launcher_status():
    with status_lock:
        snapshot = copy.deepcopy(current_status)
    return snapshot
