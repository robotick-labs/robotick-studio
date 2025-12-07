import asyncio
import contextlib
import copy
from datetime import datetime
import multiprocessing as mp
import queue as queue_module
from pathlib import Path
import sys
import threading
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
current_profile: Optional[str] = None
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


def _apply_status_event(message: Dict[str, Any]):
    event = message.get("event")
    if event == "phase":
        phase = message.get("phase")
        phase_status = message.get("status")
        with status_lock:
            current_status["phase"] = phase
            if phase == "run" and phase_status in ("starting", "in_progress"):
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
            if message.get("detail"):
                model_entry["detail"] = message["detail"]
    elif event == "result":
        with status_lock:
            current_status["result"] = message.get("result")
            if current_status.get("status") not in ("error",):
                current_status["status"] = message.get("result", {}).get(
                    "status", "completed"
                )
    elif event == "error":
        with status_lock:
            current_status["status"] = "error"
            current_status["detail"] = message.get("detail")


def _broadcast_log(line: str, loop: asyncio.AbstractEventLoop):
    if not line:
        return
    tag = current_profile or "profile"
    now = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    msg = f"{ANSI_BOLD_YELLOW}{now}{ANSI_RESET} " f"{line}"

    with log_lock:
        for queue in log_subscribers:
            loop.call_soon_threadsafe(queue.put_nowait, msg)


def _status_consumer(loop: asyncio.AbstractEventLoop):
    global process_handle, status_queue, status_thread, current_profile, log_loop

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
        status_thread = None

    if proc_to_join:
        proc_to_join.join(timeout=1)
    if queue_to_close:
        queue_to_close.close()

    with status_lock:
        if current_status.get("status") not in ("error", "completed"):
            current_status["status"] = "stopped"


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
            await websocket.send_text(line)
    except WebSocketDisconnect:
        print("[WebSocket] Client disconnected")
    finally:
        with log_lock:
            log_subscribers.remove(queue)
        print("[WebSocket] Closed")


@router.post("/run")
async def run_launcher(
    project_path: Path = Query(
        ..., description="Absolute path to the project YAML file"
    ),
    profile: str = Query(
        ..., description="Launcher profile string, e.g. 'local:model-id'"
    ),
):
    global process_handle, status_queue, status_thread, current_profile, log_loop

    print(f"[Launcher] Requested run: {project_path=} | {profile=}")

    if process_handle and process_handle.is_alive():
        return {"status": "already running"}

    if ":" not in profile:
        return {
            "status": "error",
            "detail": "Invalid profile format (expected 'local:model-id')",
        }

    base_dir = project_path.parent
    project_name = project_path.name.removesuffix(".project.yaml")

    _set_initial_status(profile)
    current_profile = profile

    try:
        status_queue = _mp_ctx.Queue()
        process_handle = _mp_ctx.Process(
            target=_run_profile_worker,
            args=(project_name, profile, str(base_dir), status_queue),
            daemon=True,
        )
        process_handle.start()
    except Exception as exc:
        process_handle = None
        if status_queue:
            try:
                status_queue.close()
                status_queue.join_thread()
            except Exception as queue_exc:  # pragma: no cover - best-effort cleanup
                print(f"[Launcher] Failed to close status queue cleanly: {queue_exc}")
        status_queue = None
        current_profile = None
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
def stop_launcher():
    global process_handle, status_queue, status_thread, current_profile, log_loop

    print("[Launcher] Requested stop")

    with lifecycle_lock:
        proc = process_handle
        queue = status_queue
        thread = status_thread
        process_handle = None
        status_queue = None
        status_thread = None
        current_profile = None
        log_loop = None

    if proc and proc.is_alive():
        proc.terminate()
        proc.join(timeout=3)

    if queue:
        try:
            queue.put_nowait(None)
        except Exception:
            pass
        finally:
            queue.close()

    if thread and thread.is_alive():
        thread.join(timeout=1)

    with status_lock:
        current_status["status"] = "stopped"

    return {"status": "stopped"}


@router.get("/status")
def get_launcher_status():
    with status_lock:
        snapshot = copy.deepcopy(current_status)
    return snapshot
