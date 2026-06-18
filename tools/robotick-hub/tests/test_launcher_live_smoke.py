from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pytest


def _json_from_output(text: str) -> dict[str, Any]:
    start = text.find("{")
    if start < 0:
        raise AssertionError(f"Command did not return JSON: {text}")
    return json.loads(text[start:])


def _hub_endpoint(workspace_root: Path) -> str:
    result = subprocess.run(
        [str(workspace_root / "tools" / "robotick"), "hub", "status"],
        cwd=workspace_root,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=15,
    )
    payload = _json_from_output(result.stdout)
    if payload.get("state") != "running":
        pytest.skip("Robotick Hub is not running for live launcher smoke.")
    endpoint = str(payload.get("endpoint") or "").rstrip("/")
    if not endpoint:
        pytest.skip("Robotick Hub did not report an endpoint.")
    return endpoint


def _request_json(
    endpoint: str,
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout: float = 10,
) -> dict[str, Any]:
    body = None
    headers = {}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(
        f"{endpoint}{path}",
        data=body,
        headers=headers,
        method=method,
    )
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _timed_post(
    endpoint: str,
    path: str,
    payload: dict[str, Any],
) -> tuple[float, dict[str, Any]]:
    started = time.perf_counter()
    response = _request_json(endpoint, path, method="POST", payload=payload)
    return (time.perf_counter() - started) * 1000, response


def _runtime(endpoint: str, project_id: str) -> dict[str, Any]:
    query = urlencode({"project_id": project_id})
    return _request_json(endpoint, f"/v1/launcher/runtime?{query}")


def _model_actions(runtime: dict[str, Any]) -> set[str]:
    actions = set()
    for model in runtime.get("models") or []:
        if not isinstance(model, dict):
            continue
        operation = model.get("operation")
        if isinstance(operation, dict) and operation.get("action"):
            actions.add(str(operation["action"]))
        lifecycle = str(model.get("lifecycle") or "").strip()
        if lifecycle:
            actions.add(lifecycle)
    return actions


def _wait_until(
    endpoint: str,
    project_id: str,
    predicate: Callable[[dict[str, Any]], bool],
    *,
    timeout_ms: float,
) -> tuple[float, dict[str, Any]]:
    started = time.perf_counter()
    deadline = started + (timeout_ms / 1000)
    last_runtime: dict[str, Any] | None = None
    while time.perf_counter() <= deadline:
        last_runtime = _runtime(endpoint, project_id)
        if predicate(last_runtime):
            return (time.perf_counter() - started) * 1000, last_runtime
        time.sleep(0.05)
    raise AssertionError(
        f"Timed out waiting for launcher runtime predicate. Last runtime: {last_runtime}"
    )


def _project_is_stopped(runtime: dict[str, Any]) -> bool:
    return all(
        str(model.get("lifecycle") or "") not in {"starting", "running", "stopping"}
        for model in runtime.get("models") or []
        if isinstance(model, dict)
    )


@pytest.mark.skipif(
    os.environ.get("ROBOTICK_LIVE_LAUNCHER_SMOKE") != "1",
    reason="Set ROBOTICK_LIVE_LAUNCHER_SMOKE=1 and ROBOTICK_LIVE_WORKSPACE_ROOT to run live launcher smoke.",
)
def test_live_launcher_non_wait_requests_publish_pending_runtime_state() -> None:
    workspace_raw = os.environ.get("ROBOTICK_LIVE_WORKSPACE_ROOT")
    if not workspace_raw:
        pytest.skip("ROBOTICK_LIVE_WORKSPACE_ROOT is required for live launcher smoke.")
    workspace_root = Path(workspace_raw).expanduser().resolve()
    project_id = os.environ.get("ROBOTICK_LIVE_LAUNCHER_PROJECT", "barr-e")
    profile = os.environ.get("ROBOTICK_LIVE_LAUNCHER_PROFILE", "native:ALL")
    max_ack_ms = float(os.environ.get("ROBOTICK_LIVE_LAUNCHER_MAX_ACK_MS", "1500"))
    max_pending_ms = float(os.environ.get("ROBOTICK_LIVE_LAUNCHER_MAX_PENDING_MS", "1500"))

    endpoint = _hub_endpoint(workspace_root)
    creator = {"client": "pytest-live-launcher-smoke"}

    try:
        _request_json(
            endpoint,
            "/v1/launcher/models/stop",
            method="POST",
            payload={"project_name": project_id, "creator": creator},
            timeout=5,
        )
        _wait_until(
            endpoint,
            project_id,
            _project_is_stopped,
            timeout_ms=30000,
        )

        launch_ack_ms, _launch_payload = _timed_post(
            endpoint,
            "/v1/launcher/models/launch",
            {
                "project_name": project_id,
                "profile": profile,
                "creator": creator,
            },
        )
        assert launch_ack_ms <= max_ack_ms
        launch_pending_ms, launch_runtime = _wait_until(
            endpoint,
            project_id,
            lambda runtime: bool(_model_actions(runtime) & {"launching", "starting"}),
            timeout_ms=max_pending_ms,
        )
        assert launch_pending_ms <= max_pending_ms
        assert _model_actions(launch_runtime) & {"launching", "starting"}

        restart_ack_ms, _restart_payload = _timed_post(
            endpoint,
            "/v1/launcher/models/restart",
            {
                "project_name": project_id,
                "profile": profile,
                "creator": creator,
            },
        )
        assert restart_ack_ms <= max_ack_ms
        restart_pending_ms, restart_runtime = _wait_until(
            endpoint,
            project_id,
            lambda runtime: bool(
                _model_actions(runtime) & {"restarting", "stopping", "launching", "starting"}
            ),
            timeout_ms=max_pending_ms,
        )
        assert restart_pending_ms <= max_pending_ms
        assert _model_actions(restart_runtime) & {
            "restarting",
            "stopping",
            "launching",
            "starting",
        }
    finally:
        try:
            _request_json(
                endpoint,
                "/v1/launcher/models/stop",
                method="POST",
                payload={"project_name": project_id, "creator": creator},
                timeout=5,
            )
        except Exception:
            pass
