from __future__ import annotations

from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import json
from urllib.parse import unquote, urlparse

import pytest

import robotick_cli.hub_client as hub_client_module
import robotick_cli.hub
import robotick_cli.launcher
import robotick_cli.studio
from robotick_cli.app.context import AppContext, ShellState
from robotick_cli.app.errors import CliError
from robotick_cli.hub_client import (
    HubRecord,
    discover_hub,
    desktop_tray_expected,
    ensure_hub,
    get_hub_record_path,
    is_hub_compatible,
)
from robotick_cli.interfaces.completion import get_completion_matches
import robotick_cli.interfaces.repl as repl_module
from robotick_cli.instances import parse_instance_pid, reconcile_bound_instance
from robotick_cli.instances import InstanceRecord
from robotick_cli.interfaces.repl import (
    apply_cd,
    bind_opened_instance_to_state,
    bind_top_level_studio_open_to_state,
    handle_bound_instance_quit,
    start_interactive_shell,
    step_back,
    try_handle_top_level_studio_open,
    try_enter_context_directly,
)
from robotick_cli.language.help import (
    format_shell_context,
    get_prompt,
    get_studio_help_text,
)
from robotick_cli.language.registry import get_studio_command_spec
from robotick_cli.studio import CommandResult


CLI_DIR = Path(__file__).resolve().parents[1]
CLI_SRC = CLI_DIR / "src"
HUB_DIR = CLI_DIR.parent / "robotick-hub"
LAUNCHER_DIR = CLI_DIR.parent / "robotick-launcher"
STUDIO_ABILITY_DIR = CLI_DIR.parent / "robotick-studio-ability"


def compatible_hub_health(*, tray_active: bool = False) -> dict[str, object]:
    return {
        "status": "ok",
        "api_version": hub_client_module.REQUIRED_HUB_API_VERSION,
        "features": sorted(hub_client_module.REQUIRED_HUB_FEATURES),
        "tray_active": tray_active,
    }


def write_executable(file_path: Path, contents: str) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(contents, encoding="utf-8")
    file_path.chmod(0o755)


def create_fake_workspace() -> Path:
    root = Path(tempfile.mkdtemp(prefix="robotick-cli-test-"))
    studio_root = root / "robotick" / "robotick-studio"
    (studio_root / "tools").mkdir(parents=True, exist_ok=True)
    (root / "robotick.yaml").write_text(
        "\n".join(
            [
                "schema_version: 1",
                "",
                "studio:",
                "  default_path: robotick/robotick-studio",
                "  default_mode: dev",
                "",
                "projects:",
                "  barr-e:",
                "    project_dir: robots/barr-e",
                "",
            ]
        ),
        encoding="utf-8",
    )
    write_executable(
        studio_root / "run-studio-dev-direct.sh",
        "#!/usr/bin/env bash\nset -euo pipefail\nsleep 30\n",
    )
    write_executable(
        root / "robots" / "barr-e" / "run-studio.sh",
        "#!/usr/bin/env bash\nset -euo pipefail\nsleep 30\n",
    )
    (root / "robots" / "barr-e" / "studio").mkdir(parents=True, exist_ok=True)
    (root / "robots" / "barr-e" / "studio" / "studio.yaml").write_text(
        "\n".join(
            [
                "resourceType: studio_document",
                "schemaVersion: 1",
                "id: barr-e-studio",
                "windows:",
                "  - id: main",
                "    label: Main Window",
                "    windowRole: main",
                "    defaultWorkbenchId: remote-control",
                "    workbenches:",
                "      - id: remote-control",
                "        label: Remote Control",
                "        group: test",
                "        defaultEditorId: remote-control",
                "        layouts:",
                "          - dock:",
                "              nodeType: split",
                "              direction: horizontal",
                "              ratio: 0.7",
                "              children:",
                "                - nodeType: panel",
                "                  panelId: panel-remote-control",
                "                  editorId: remote-control",
                "                  settings:",
                "                    selectedStream: Chase",
                "                - nodeType: panel",
                "                  panelId: panel-telemetry",
                "                  editorId: telemetry",
                "            floatingPanels:",
                "              - id: panel-face-preview",
                "                editorId: streaming-image-viewer",
                "                settings:",
                "                  source: face-camera",
                "                frame:",
                "                  x: 100",
                "                  y: 120",
                "                  width: 320",
                "                  height: 240",
                "  - id: child-window-1",
                "    label: Animation Window",
                "    windowRole: child",
                "    workbenches:",
                "      - id: anim",
                "        label: Animation",
                "        group: dev",
                "        defaultEditorId: animation-editor",
                "        layouts:",
                "          - dock:",
                "              nodeType: panel",
                "              panelId: panel-anim",
                "              editorId: animation-editor",
            ]
        ),
        encoding="utf-8",
    )
    (studio_root / "tools" / "robotick-hub").symlink_to(HUB_DIR, target_is_directory=True)
    (studio_root / "tools" / "robotick-launcher").symlink_to(
        LAUNCHER_DIR, target_is_directory=True
    )
    (studio_root / "tools" / "robotick-studio-ability").symlink_to(
        STUDIO_ABILITY_DIR, target_is_directory=True
    )
    return root


def terminate_pid(pid: int | None) -> None:
    if not pid:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return
    started_at = time.time()
    while time.time() - started_at < 2:
        try:
            os.kill(pid, 0)
        except OSError:
            return
        time.sleep(0.05)
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        return


def run_cli(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{CLI_SRC}{os.pathsep}{env.get('PYTHONPATH', '')}".rstrip(os.pathsep)
    env["ROBOTICK_HUB_FORCE_HEADLESS"] = "1"
    return subprocess.run(
        [sys.executable, "-m", "robotick_cli", *args],
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def run_shell(inputs: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = f"{CLI_SRC}{os.pathsep}{env.get('PYTHONPATH', '')}".rstrip(os.pathsep)
    env["ROBOTICK_HUB_FORCE_HEADLESS"] = "1"
    return subprocess.run(
        [sys.executable, "-m", "robotick_cli"],
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
        input="\n".join(inputs) + "\n",
        check=False,
    )


def wait_for(condition, timeout_ms: int = 3000) -> None:
    started_at = time.time()
    while (time.time() - started_at) * 1000 < timeout_ms:
        if condition():
            return
        time.sleep(0.05)
    raise AssertionError("Timed out waiting for condition")


def opened_instance_name_from_stdout(stdout: str) -> str:
    payload = json.loads(stdout)
    return str(payload["instance"]["name"])


@contextmanager
def fake_studio_control_server(
    responses: dict[str, tuple[int, dict[str, object]]],
):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
            status_code, payload = responses.get(
                path,
                (
                    404,
                    {
                        "error": {
                            "code": "not_found",
                            "message": f"Unhandled Studio control path: {path}",
                        }
                    },
                ),
            )
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args) -> None:  # noqa: A003
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}"
    try:
        yield endpoint
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@contextmanager
def live_studio_instance(
    workspace: Path,
    *,
    instance_name: str = "studio-1234",
    control_endpoint: str,
    project_name: str = "barr-e",
) -> str:
    from robotick_cli.instances import write_instance_record

    child = subprocess.Popen(
        ["bash", "-lc", "exec -a run-studio-dev-direct.sh sleep 30"],
        start_new_session=True,
    )
    try:
        write_instance_record(
            workspace,
            InstanceRecord(
                name=instance_name,
                pid=child.pid,
                mode="dev",
                project_name=project_name,
                started_at="2026-06-06T12:00:00+00:00",
                control_endpoint=control_endpoint,
            ),
        )
        yield instance_name
    finally:
        terminate_pid(child.pid)


@contextmanager
def managed_headless_hub(workspace: Path):
    previous = os.environ.get("ROBOTICK_HUB_FORCE_HEADLESS")
    os.environ["ROBOTICK_HUB_FORCE_HEADLESS"] = "1"
    record = ensure_hub(workspace)
    try:
        yield record
    finally:
        terminate_pid(record.pid)
        if previous is None:
            os.environ.pop("ROBOTICK_HUB_FORCE_HEADLESS", None)
        else:
            os.environ["ROBOTICK_HUB_FORCE_HEADLESS"] = previous


def studio_status_fixture(instance_name: str = "studio-1234") -> dict[str, tuple[int, dict[str, object]]]:
    return {
        "/v1/status": (
            200,
            {
                "resource_type": "studio_instance",
                "id": instance_name,
                "project_name": "barr-e",
                "state_sources": {"active_window_id": "live"},
                "child_collections": [{"name": "windows", "resource_type": "studio_windows"}],
                "children": {
                    "windows": [
                        {
                            "resource_type": "studio_window",
                            "id": "main",
                        }
                    ]
                },
            },
        ),
        "/v1/studio/windows/status": (
            200,
            {
                "resource_type": "studio_windows",
                "child_collections": [],
                "child_resources": [{"id": "main"}, {"id": "child-window-1"}],
            },
        ),
        "/v1/studio/windows/main/status": (
            200,
            {
                "resource_type": "studio_window",
                "id": "main",
                "state_sources": {"active_workbench_id": "live"},
                "child_collections": [{"name": "workbenches", "resource_type": "studio_workbenches"}],
                "children": {
                    "workbenches": [
                        {
                            "resource_type": "studio_workbench",
                            "id": "remote-control",
                        }
                    ]
                },
            },
        ),
        "/v1/studio/windows/main/workbenches/status": (
            200,
            {
                "resource_type": "studio_workbenches",
                "child_collections": [],
                "child_resources": [{"id": "remote-control"}],
            },
        ),
        "/v1/studio/windows/main/workbenches/remote-control/status": (
            200,
            {
                "resource_type": "studio_workbench",
                "id": "remote-control",
                "active_layout_id": "main:remote-control:default",
                "state_sources": {"active_layout_id": "live"},
                "child_collections": [{"name": "layouts", "resource_type": "studio_layouts"}],
                "children": {
                    "layouts": [
                        {
                            "resource_type": "studio_layout",
                            "id": "main:remote-control:default",
                        }
                    ]
                },
            },
        ),
        "/v1/studio/windows/main/workbenches/remote-control/layouts/status": (
            200,
            {
                "resource_type": "studio_layouts",
                "child_collections": [],
                "child_resources": [{"id": "main:remote-control:default"}],
            },
        ),
        "/v1/studio/windows/main/workbenches/remote-control/layouts/main:remote-control:default/status": (
            200,
            {
                "resource_type": "studio_layout",
                "id": "main:remote-control:default",
                "diagnostics": {"source": "computed", "items": []},
                "child_collections": [{"name": "panels", "resource_type": "studio_panels"}],
                "child_resources": [{"id": "panel-face-preview"}],
            },
        ),
        "/v1/studio/windows/main/workbenches/remote-control/layouts/main:remote-control:default/panels/status": (
            200,
            {
                "resource_type": "studio_panels",
                "child_collections": [],
                "child_resources": [{"id": "panel-face-preview"}],
            },
        ),
        "/v1/studio/windows/main/workbenches/remote-control/layouts/main:remote-control:default/panels/panel-face-preview/status": (
            200,
            {
                "resource_type": "studio_panel",
                "id": "panel-face-preview",
                "settings": {"source": "face-camera"},
                "diagnostics": {"source": "placeholder", "items": []},
                "child_collections": [],
                "child_resources": [],
            },
        ),
    }


def test_top_level_ls_presents_contexts_separately_from_actions() -> None:
    text = format_shell_context(ShellState(), str(create_fake_workspace()))
    assert "Available here:" in text
    assert "- hub/       Inspect the local Robotick hub for this workspace" in text
    assert "- launcher/  Inspect launcher capability state through robotick-hub" in text
    assert "- studio/    Open and inspect Robotick Studio projects in this workspace" in text
    assert "- ls     List available namespaces and shell commands" in text
    assert "- help   Show this help" in text


def test_launcher_ls_exposes_launcher_actions() -> None:
    text = format_shell_context(ShellState(namespace="launcher"), str(create_fake_workspace()))
    assert "Available in launcher:" in text
    assert "- launch [project]" in text
    assert "- status" in text
    assert "- wait-ready" in text
    assert "- logs" in text
    assert "- stop" in text
    assert "- restart" in text
    assert "- ensure" in text
    assert "- back" in text


def test_studio_ls_exposes_instance_folders_as_contexts_and_open_as_action() -> None:
    workspace = create_fake_workspace()
    run_cli(["studio", "open"], workspace)
    text = format_shell_context(ShellState(namespace="studio"), str(workspace))
    assert "Available in studio:" in text
    assert "Contexts:\n- studio-" in text
    assert "- projects" in text
    assert "List registered Studio projects from robotick.yaml" in text
    assert "- instances" in text
    assert "List live Studio instances tracked in .robotick/instances" in text
    assert "- launcher-status" in text
    assert "- open [project]" in text
    assert "Convenience launch; in the immediate shell it creates then enters the instance" in text


def test_top_level_help_is_reference_oriented() -> None:
    text = repl_module.format_shell_help(ShellState())
    assert "Current context: top level" in text
    assert "Namespaces:" in text
    assert "Notes:" in text
    assert "Query commands return JSON and do not start dependencies." in text
    assert "Examples:" in text


def test_interactive_shell_formatting_can_opt_into_ansi_styling() -> None:
    text = format_shell_context(ShellState(), str(create_fake_workspace()), color=True)
    prompt = get_prompt(ShellState(namespace="studio"), color=True)
    assert "\x1b[" in text
    assert "\x1b[" in prompt
    assert "Available here:" in text
    assert "robotick" in prompt


def test_launcher_help_describes_status_and_ensure_by_semantics() -> None:
    text = repl_module.format_shell_help(ShellState(namespace="launcher"))
    assert "Current context: launcher" in text
    assert "Commands:" in text
    assert "Output:" in text
    assert "status returns launcher service state and per-model runtime status as JSON." in text
    assert "launch, stop, and restart operate on project/model selections." in text


def test_bound_studio_help_describes_navigation_and_output() -> None:
    text = repl_module.format_shell_help(
        ShellState(namespace="studio", instance_name="studio-12345")
    )
    assert "Current context: studio/studio-12345" in text
    assert "Navigation:" in text
    assert "Output:" in text
    assert "Live Studio status requires a running control service on the bound instance." in text


def test_studio_help_is_generated_from_command_registry() -> None:
    open_spec = get_studio_command_spec("open")
    help_text = get_studio_help_text()
    assert "Current context: studio" in help_text
    assert "Commands:" in help_text
    assert open_spec.summary in help_text
    assert "open and create return JSON in one-shot CLI usage." in help_text


def test_hub_status_is_read_only_and_json_by_default() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["hub", "status"], workspace)

    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["resource_type"] == "robotick_hub_status"
    assert payload["state"] == "stopped"
    assert discover_hub(workspace) is None


def test_hub_ensure_starts_hub_and_reports_json() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["hub", "ensure"], workspace)

    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["resource_type"] == "robotick_hub_ensure_result"
    assert payload["action"] in {"started", "reused", "restarted"}
    assert payload["status"]["state"] == "running"
    assert payload["status"]["endpoint"].startswith("http://127.0.0.1:")
    record = discover_hub(workspace)
    assert record is not None
    terminate_pid(record.pid)


def test_hub_projects_reads_workspace_projects_through_hub_json() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["hub", "projects"], workspace)
    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["projects"][0]["name"] == "barr-e"

    record = discover_hub(workspace)
    assert record is not None
    terminate_pid(record.pid)


def test_launcher_status_is_read_only_and_json_by_default() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["launcher", "status"], workspace)

    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["resource_type"] == "robotick_launcher_status"
    assert payload["service"]["state"] == "hub_unavailable"
    assert discover_hub(workspace) is None
    assert not (workspace / ".robotick" / "launcher.json").exists()


def test_launcher_ensure_starts_hub_managed_launcher_path() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["launcher", "ensure"], workspace)

    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["resource_type"] == "robotick_launcher_ensure_result"
    assert payload["action"] in {"started", "reused", "restarted"}
    assert payload["status"]["service"]["state"] == "stopped"
    assert payload["status"]["service"]["endpoint"].startswith("http://127.0.0.1:")
    assert payload["status"]["service"]["pid"] is not None
    assert payload["status"]["runtime"]["status"] == "stopped"

    record = discover_hub(workspace)
    assert record is not None
    terminate_pid(record.pid)
    launcher_record_path = workspace / ".robotick" / "launcher.json"
    if launcher_record_path.exists():
        launcher_payload = json.loads(launcher_record_path.read_text(encoding="utf-8"))
        terminate_pid(launcher_payload.get("pid"))


def test_launcher_ensure_reads_status_without_launcher_capability_post(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    record = HubRecord(endpoint="http://127.0.0.1:7099", pid=1234)
    captured: dict[str, object] = {}

    monkeypatch.setattr("robotick_cli.launcher.discover_hub", lambda _workspace: None)
    monkeypatch.setattr("robotick_cli.launcher.ensure_hub", lambda _workspace: record)
    monkeypatch.setattr(
        "robotick_cli.launcher.fetch_launcher_status_through_hub",
        lambda _record: {
            "resource_type": "robotick_launcher_status",
            "runtime": {
                "resource_type": "robotick_launcher_runtime_status",
                "state": "stopped",
                "models": [],
            },
        },
    )
    monkeypatch.setattr(
        "robotick_cli.launcher.post_hub_json",
        lambda *_args, **_kwargs: pytest.fail("launcher ensure should not post to launcher capability routes"),
    )
    monkeypatch.setattr(
        "robotick_cli.launcher.write_json",
        lambda result: captured.__setitem__("output", result),
    )

    result = robotick_cli.launcher.run_launcher_command(
        AppContext(workspace_root=workspace),
        ["ensure"],
    )

    assert result.exit_code == 0
    assert captured["output"]["action"] == "started"
    assert captured["output"]["status"]["service"]["state"] == "stopped"
    assert captured["output"]["status"]["service"]["endpoint"] == record.endpoint
    assert captured["output"]["status"]["service"]["pid"] == record.pid


def test_hub_restart_command_reports_restarted_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    record = HubRecord(endpoint="http://127.0.0.1:7099", pid=1234)
    captured: dict[str, object] = {}

    monkeypatch.setattr("robotick_cli.hub.restart_hub", lambda _workspace: record)
    monkeypatch.setattr(
        "robotick_cli.hub.build_running_hub_status",
        lambda _record: {
            "resource_type": "robotick_hub_status",
            "state": "running",
            "endpoint": record.endpoint,
            "pid": record.pid,
        },
    )
    monkeypatch.setattr(
        "robotick_cli.hub.write_json",
        lambda result: captured.__setitem__("output", result),
    )

    result = robotick_cli.hub.run_hub_command(
        AppContext(workspace_root=workspace),
        ["restart"],
    )

    assert result.exit_code == 0
    assert captured["output"] == {
        "resource_type": "robotick_hub_restart_result",
        "action": "restarted",
        "status": {
            "resource_type": "robotick_hub_status",
            "state": "running",
            "endpoint": record.endpoint,
            "pid": record.pid,
        },
    }


def test_studio_launcher_status_compares_runtime_and_projection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    record = HubRecord(endpoint="http://127.0.0.1:7099", pid=1234)
    captured: dict[str, object] = {}

    monkeypatch.setattr("robotick_cli.studio.ensure_hub", lambda _workspace: record)

    def fake_fetch(_record, path):
        if path == "/v1/launcher/runtime?project_id=barr-e":
            return {
                "resource_type": "robotick_launcher_runtime_status",
                "state": "stopped",
                "models": [
                    {
                        "project_id": "barr-e",
                        "model_id": "face",
                        "lifecycle": "stopped",
                        "freshness": "stopped",
                    }
                ],
            }
        raise AssertionError(f"Unexpected path: {path}")

    monkeypatch.setattr("robotick_cli.studio.fetch_hub_json", fake_fetch)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["launcher-status", "barr-e"],
    )

    assert result.exit_code == 0
    output = captured["output"]
    assert output["resource_type"] == "robotick_studio_launcher_status"
    assert output["project_name"] == "barr-e"
    assert output["comparison"] == {
        "state_agrees": True,
        "hub_state": "stopped",
        "studio_state": "stopped",
    }
    assert output["studio_projection"]["service"]["state"] == "stopped"
    assert output["studio_projection"]["runtime"]["models"] == [
        {
            "project_id": "barr-e",
            "model_id": "face",
            "lifecycle": "stopped",
            "freshness": "stopped",
        }
    ]


def test_studio_focused_prefers_currently_focused_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}
    instances = [
        InstanceRecord(
            name="studio-1111",
            pid=1111,
            mode="dev",
            started_at="2026-06-12T18:00:00+00:00",
            control_endpoint="http://127.0.0.1:1111",
        ),
        InstanceRecord(
            name="studio-2222",
            pid=2222,
            mode="dev",
            started_at="2026-06-12T18:01:00+00:00",
            control_endpoint="http://127.0.0.1:2222",
        ),
    ]

    def fake_fetch(_workspace, path):
        instance_name = path.split("/")[4]
        return {
            "resource_type": "robotick_studio_focused",
            "instance_name": instance_name,
            "project_name": "pip-e" if instance_name == "studio-1111" else "alf-e",
            "is_focused": instance_name == "studio-1111",
            "last_focused_at": "2026-06-12T18:00:00+00:00",
            "window_id": "main",
            "workbench_id": "models",
            "layout_id": "main:models:default",
        }

    monkeypatch.setattr("robotick_cli.studio.list_live_instances", lambda _workspace: instances)
    monkeypatch.setattr("robotick_cli.studio.fetch_studio_hub_json", fake_fetch)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["focused"],
    )

    assert result.exit_code == 0
    output = captured["output"]
    assert output["instance_name"] == "studio-1111"
    assert output["project_name"] == "pip-e"
    assert output["selection_policy"] == "focused-window-then-last-focused-then-newest-instance"
    assert len(output["candidates"]) == 2


def test_studio_focused_falls_back_to_most_recent_focus(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}
    instances = [
        InstanceRecord(
            name="studio-1111",
            pid=1111,
            mode="dev",
            started_at="2026-06-12T18:00:00+00:00",
            control_endpoint="http://127.0.0.1:1111",
        ),
        InstanceRecord(
            name="studio-2222",
            pid=2222,
            mode="dev",
            started_at="2026-06-12T18:01:00+00:00",
            control_endpoint="http://127.0.0.1:2222",
        ),
    ]

    def fake_fetch(_workspace, path):
        instance_name = path.split("/")[4]
        return {
            "resource_type": "robotick_studio_focused",
            "instance_name": instance_name,
            "project_name": instance_name,
            "is_focused": False,
            "last_focused_at": (
                "2026-06-12T18:03:00+00:00"
                if instance_name == "studio-2222"
                else "2026-06-12T18:02:00+00:00"
            ),
            "window_id": "main",
            "workbench_id": "remote-control",
            "layout_id": "main:remote-control:default",
        }

    monkeypatch.setattr("robotick_cli.studio.list_live_instances", lambda _workspace: instances)
    monkeypatch.setattr("robotick_cli.studio.fetch_studio_hub_json", fake_fetch)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["focused"],
    )

    assert result.exit_code == 0
    assert captured["output"]["instance_name"] == "studio-2222"


def test_launcher_launch_posts_profile_and_intent_payloads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    record = HubRecord(endpoint="http://127.0.0.1:7099", pid=1234)
    captured: dict[str, object] = {}

    monkeypatch.setattr("robotick_cli.launcher.ensure_hub", lambda _workspace: record)

    def fake_post(_record, path, payload=None, *, timeout_seconds=2):
        captured["path"] = path
        captured["payload"] = payload
        captured["timeout_seconds"] = timeout_seconds
        return {"group": {"id": "msg_demo"}, "sessions": []}

    monkeypatch.setattr("robotick_cli.launcher.post_hub_json", fake_post)
    monkeypatch.setattr(
        "robotick_cli.launcher.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.launcher.run_launcher_command(
        AppContext(workspace_root=workspace),
        ["launch", "barr-e", "native:ALL"],
    )
    assert result.exit_code == 0
    assert captured["path"] == "/v1/launcher/models/launch"
    assert captured["timeout_seconds"] == 120
    assert captured["payload"] == {
        "project_name": "barr-e",
        "creator": {"client": "robotick-cli", "instance_id": f"cli-{os.getpid()}"},
        "profile": "native:ALL",
    }
    assert captured["output"] == {
        "resource_type": "robotick_launcher_launch_result",
        "group": {"id": "msg_demo"},
        "sessions": [],
    }

    result = robotick_cli.launcher.run_launcher_command(
        AppContext(workspace_root=workspace),
        ["launch", "barr-e", "--model", "brain", "--local"],
    )
    assert result.exit_code == 0
    assert captured["payload"] == {
        "project_name": "barr-e",
        "creator": {"client": "robotick-cli", "instance_id": f"cli-{os.getpid()}"},
        "intent": {
            "project": "barr-e",
            "scope": {"kind": "model", "value": "brain"},
            "target_policy": "local",
        },
    }


def test_launcher_status_filters_project_and_model_selection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    record = HubRecord(endpoint="http://127.0.0.1:7099", pid=1234)
    captured: dict[str, object] = {}
    payload = {
        "resource_type": "robotick_launcher_runtime_status",
        "state": "running",
        "models": [
            {"project_id": "barr-e", "model_id": "brain", "lifecycle": "running", "freshness": "live"},
        ],
    }

    monkeypatch.setattr("robotick_cli.launcher.discover_hub", lambda _workspace: record)
    monkeypatch.setattr("robotick_cli.launcher.is_pid_alive", lambda _pid: True)

    def fake_runtime(_record, *, project_id=None, model_ids=None):
        captured["project_id"] = project_id
        captured["model_ids"] = model_ids
        return payload

    monkeypatch.setattr("robotick_cli.launcher.fetch_launcher_runtime_through_hub", fake_runtime)
    monkeypatch.setattr(
        "robotick_cli.launcher.write_json",
        lambda result: captured.__setitem__("output", result),
    )

    result = robotick_cli.launcher.run_launcher_command(
        AppContext(workspace_root=workspace),
        ["status", "--project", "barr-e", "--model", "brain"],
    )
    assert result.exit_code == 0
    assert captured["project_id"] == "barr-e"
    assert captured["model_ids"] == ["brain"]
    assert captured["output"]["service"]["state"] == "running"
    assert "groups" not in captured["output"]
    assert "sessions" not in captured["output"]


def test_launcher_status_uses_runtime_projection_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    record = HubRecord(endpoint="http://127.0.0.1:7099", pid=1234)
    captured: dict[str, object] = {}
    payload = {
        "resource_type": "robotick_launcher_runtime_status",
        "state": "stopped",
        "models": [
            {
                "project_id": "barr-e",
                "model_id": "face",
                "lifecycle": "stopped",
                "readiness": "pending",
                "freshness": "stopped",
            },
        ],
    }

    monkeypatch.setattr("robotick_cli.launcher.discover_hub", lambda _workspace: record)
    monkeypatch.setattr("robotick_cli.launcher.is_pid_alive", lambda _pid: True)
    monkeypatch.setattr("robotick_cli.launcher.fetch_launcher_runtime_through_hub", lambda *_args, **_kwargs: payload)
    monkeypatch.setattr(
        "robotick_cli.launcher.write_json",
        lambda result: captured.__setitem__("output", result),
    )

    result = robotick_cli.launcher.run_launcher_command(
        AppContext(workspace_root=workspace),
        ["status", "--project", "barr-e", "--model", "face"],
    )

    assert result.exit_code == 0
    assert captured["output"]["service"]["state"] == "stopped"
    assert captured["output"]["runtime"]["models"] == [
        {
            "project_id": "barr-e",
            "model_id": "face",
            "lifecycle": "stopped",
            "readiness": "pending",
            "freshness": "stopped",
        }
    ]
    assert "groups" not in captured["output"]
    assert "sessions" not in captured["output"]


def test_launcher_stop_and_restart_use_model_control_endpoints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    record = HubRecord(endpoint="http://127.0.0.1:7099", pid=1234)
    captured: dict[str, object] = {}

    monkeypatch.setattr("robotick_cli.launcher.ensure_hub", lambda _workspace: record)

    def fake_post(_record, path, payload=None, *, timeout_seconds=2):
        captured["path"] = path
        captured["payload"] = payload
        captured["timeout_seconds"] = timeout_seconds
        return {"project_id": "barr-e", "stopped_sessions": []}

    monkeypatch.setattr("robotick_cli.launcher.post_hub_json", fake_post)
    monkeypatch.setattr(
        "robotick_cli.launcher.write_json",
        lambda result: captured.__setitem__("output", result),
    )

    result = robotick_cli.launcher.run_launcher_command(
        AppContext(workspace_root=workspace),
        ["stop", "--project", "barr-e", "--model", "brain"],
    )
    assert result.exit_code == 0
    assert captured["path"] == "/v1/launcher/models/stop"
    assert captured["payload"]["project_name"] == "barr-e"
    assert captured["payload"]["model_ids"] == ["brain"]
    assert captured["timeout_seconds"] == 120

    result = robotick_cli.launcher.run_launcher_command(
        AppContext(workspace_root=workspace),
        ["restart", "--project", "barr-e", "--model", "brain"],
    )
    assert result.exit_code == 0
    assert captured["path"] == "/v1/launcher/models/restart"
    assert captured["payload"]["project_name"] == "barr-e"
    assert captured["payload"]["model_ids"] == ["brain"]
    assert captured["payload"]["intent"] == {
        "project": "barr-e",
        "scope": {"kind": "model", "value": "brain"},
        "target_policy": "native",
    }
    assert captured["timeout_seconds"] == 120


def test_launcher_stop_rejects_legacy_group_or_session_selection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    record = HubRecord(endpoint="http://127.0.0.1:7099", pid=1234)

    monkeypatch.setattr("robotick_cli.launcher.ensure_hub", lambda _workspace: record)

    with pytest.raises(CliError, match="Unknown argument: --group"):
        robotick_cli.launcher.run_launcher_command(
            AppContext(workspace_root=workspace),
            ["stop", "--group", "msg_demo"],
        )
    with pytest.raises(CliError, match="Unknown argument: --session"):
        robotick_cli.launcher.run_launcher_command(
            AppContext(workspace_root=workspace),
            ["restart", "--session", "ms_demo"],
        )


def test_launcher_logs_uses_model_resources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    record = HubRecord(endpoint="http://127.0.0.1:7099", pid=1234)
    captured: dict[str, object] = {}

    monkeypatch.setattr("robotick_cli.launcher.ensure_hub", lambda _workspace: record)

    def fake_fetch(_record, path):
        captured["path"] = path
        return {"resource_type": "robotick_launcher_logs", "path": path}

    monkeypatch.setattr("robotick_cli.launcher.fetch_hub_json", fake_fetch)
    monkeypatch.setattr(
        "robotick_cli.launcher.write_json",
        lambda result: captured.__setitem__("output", result),
    )

    with pytest.raises(CliError, match="Unknown argument: --session"):
        robotick_cli.launcher.run_launcher_command(
            AppContext(workspace_root=workspace),
            ["logs", "--session", "ms_brain"],
        )

    result = robotick_cli.launcher.run_launcher_command(
        AppContext(workspace_root=workspace),
        ["logs", "--project", "barr-e", "--model", "brain"],
    )
    assert result.exit_code == 0
    assert captured["path"] == "/v1/launcher/models/logs?project_id=barr-e&model_ids=brain"

    result = robotick_cli.launcher.run_launcher_command(
        AppContext(workspace_root=workspace),
        ["logs", "--project", "barr-e", "--models", "brain,face", "--tail", "50"],
    )
    assert result.exit_code == 0
    assert captured["path"] == "/v1/launcher/models/logs?project_id=barr-e&model_ids=brain%2Cface&tail=50"


def test_launcher_wait_ready_polls_until_runtime_is_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    record = HubRecord(endpoint="http://127.0.0.1:7099", pid=1234)
    captured: dict[str, object] = {}
    poll_count = {"value": 0}

    monkeypatch.setattr("robotick_cli.launcher.ensure_hub", lambda _workspace: record)

    def fake_runtime(_record, *, project_id=None, model_ids=None):
        captured["project_id"] = project_id
        captured["model_ids"] = model_ids
        poll_count["value"] += 1
        readiness = "pending" if poll_count["value"] == 1 else "ready"
        if poll_count["value"] == 1:
            lifecycle = "starting"
        else:
            lifecycle = "running"
        return {
            "resource_type": "robotick_launcher_runtime_status",
            "state": "pending" if readiness == "pending" else "running",
            "models": [
                {
                    "project_id": project_id,
                    "model_id": model_ids[0],
                    "lifecycle": lifecycle,
                    "readiness": readiness,
                    "freshness": "pending" if readiness == "pending" else "live",
                }
            ],
        }

    monkeypatch.setattr("robotick_cli.launcher.fetch_launcher_runtime_through_hub", fake_runtime)
    monkeypatch.setattr("robotick_cli.launcher.time.sleep", lambda _seconds: None)
    monkeypatch.setattr(
        "robotick_cli.launcher.write_json",
        lambda result: captured.__setitem__("output", result),
    )

    result = robotick_cli.launcher.run_launcher_command(
        AppContext(workspace_root=workspace),
        ["wait-ready", "--project", "barr-e", "--model", "brain", "--timeout-seconds", "1", "--poll-ms", "1"],
    )
    assert result.exit_code == 0
    assert captured["project_id"] == "barr-e"
    assert captured["model_ids"] == ["brain"]
    assert captured["output"]["status"] == "ready"


def test_launcher_wait_ready_ignores_stopped_history_for_project_wait(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    record = HubRecord(endpoint="http://127.0.0.1:7099", pid=1234)
    captured: dict[str, object] = {}

    monkeypatch.setattr("robotick_cli.launcher.ensure_hub", lambda _workspace: record)

    def fake_runtime(_record, *, project_id=None, model_ids=None):
        return {
            "resource_type": "robotick_launcher_runtime_status",
            "state": "running",
            "models": [
                {
                    "project_id": project_id,
                    "model_id": "old-face",
                    "lifecycle": "stopped",
                    "readiness": "pending",
                    "freshness": "stopped",
                },
                {
                    "project_id": project_id,
                    "model_id": "brain",
                    "lifecycle": "running",
                    "readiness": "ready",
                    "freshness": "live",
                },
            ],
        }

    monkeypatch.setattr("robotick_cli.launcher.fetch_launcher_runtime_through_hub", fake_runtime)
    monkeypatch.setattr(
        "robotick_cli.launcher.write_json",
        lambda result: captured.__setitem__("output", result),
    )

    result = robotick_cli.launcher.run_launcher_command(
        AppContext(workspace_root=workspace),
        ["wait-ready", "--project", "barr-e", "--timeout-seconds", "1", "--poll-ms", "1"],
    )

    assert result.exit_code == 0
    assert captured["output"]["status"] == "ready"


def test_studio_projects_uses_same_hub_backed_project_truth() -> None:
    workspace = create_fake_workspace()
    hub_result = run_cli(["hub", "projects"], workspace)
    studio_result = run_cli(["studio", "projects"], workspace)
    assert hub_result.returncode == 0
    assert studio_result.returncode == 0
    assert hub_result.stdout == studio_result.stdout

    record = discover_hub(workspace)
    assert record is not None
    terminate_pid(record.pid)


def test_interactive_shell_start_eagerly_ensures_hub() -> None:
    workspace = create_fake_workspace()
    result = run_shell(["exit"], workspace)
    assert result.returncode == 0
    record = discover_hub(workspace)
    assert record is not None
    terminate_pid(record.pid)


def test_top_level_launcher_command_remains_available_inside_studio_shell_context() -> None:
    workspace = create_fake_workspace()
    result = run_shell(["studio", "launcher status", "exit"], workspace)
    assert result.returncode == 0
    assert '"resource_type": "robotick_launcher_status"' in result.stdout
    assert '"state": "stopped"' in result.stdout

    record = discover_hub(workspace)
    assert record is not None
    terminate_pid(record.pid)
    launcher_record_path = workspace / ".robotick" / "launcher.json"
    if launcher_record_path.exists():
        launcher_payload = json.loads(launcher_record_path.read_text(encoding="utf-8"))
        terminate_pid(launcher_payload.get("pid"))


def test_bound_instance_ls_advertises_workbench_and_quit_as_actions() -> None:
    workspace = create_fake_workspace()
    with fake_studio_control_server(studio_status_fixture()) as endpoint:
        with live_studio_instance(workspace, control_endpoint=endpoint):
            with managed_headless_hub(workspace):
                text = format_shell_context(
                    ShellState(namespace="studio", instance_name="studio-1234"),
                    str(workspace),
                )
                assert "Available in studio/studio-1234:" in text
                assert "Contexts:\n- windows/" in text
                assert "Actions:" in text
                assert "- status" in text
                assert "Print the currently bound Studio resource as JSON" in text
                assert "- select-project [project]  Switch the selected project inside this Studio instance" in text
                assert "- quit" in text
                assert "Close this Studio instance" in text
                assert "- back" in text
                assert "Return to the parent shell context" in text


def test_bound_instance_ls_advertises_activate_for_activatable_resource(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    instance_name = "studio-1234"
    monkeypatch.setattr(
        "robotick_cli.language.help.fetch_studio_node_status",
        lambda _workspace, _instance_name, _path_segments: {
            "resource_type": "studio_workbench",
            "id": "home",
            "activation_target_path": ["windows", "main", "workbenches", "home"],
            "child_collections": [],
        },
    )

    text = format_shell_context(
        ShellState(
            namespace="studio",
            instance_name=instance_name,
            studio_path=("windows", "main", "workbenches", "home"),
        ),
        str(workspace),
    )

    assert "- activate" in text
    assert "Make the current Studio resource active" in text


def test_instance_help_lists_status_and_windows_context() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = opened_instance_name_from_stdout(opened.stdout)

    result = run_cli(["studio", instance_name], workspace)

    assert result.returncode == 0
    assert f"robotick studio {instance_name} status" in result.stdout
    assert (
        f"robotick studio {instance_name} diagnostics <status|endpoints|renderer|console|fetch-check|telemetry|dom|css|screenshot|snapshot>"
        in result.stdout
    )
    assert f"robotick studio {instance_name} <path...> activate" in result.stdout
    assert f"robotick studio {instance_name} select-project <project>" in result.stdout
    assert f"robotick studio {instance_name} windows" in result.stdout


def test_instance_select_project_posts_registered_project_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )
    monkeypatch.setattr(
        "robotick_cli.studio.get_hub_workspace_projects",
        lambda _ctx: [
            {
                "name": "barr-e",
                "project_dir": "robots/barr-e",
                "project_path": "/tmp/barr-e.project.yaml",
            }
        ],
    )

    def fake_post(_workspace, path, payload=None):
        captured["path"] = path
        captured["payload"] = payload
        return {
            "accepted": True,
            "currentProjectPath": "/tmp/barr-e.project.yaml",
            "issue": None,
        }

    monkeypatch.setattr("robotick_cli.studio.post_studio_hub_json", fake_post)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["studio-1234", "select-project", "barr-e"],
    )

    assert result.exit_code == 0
    assert captured["path"] == "/v1/studio/instances/studio-1234/project/select"
    assert captured["payload"] == {"project_path": "/tmp/barr-e.project.yaml"}
    assert captured["output"] == {
        "accepted": True,
        "currentProjectPath": "/tmp/barr-e.project.yaml",
        "issue": None,
    }


def test_instance_diagnostics_status_queries_hub_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    def fake_fetch(_workspace, path):
        captured["path"] = path
        return {
            "resource_type": "studio_diagnostics_status",
            "instance_id": "studio-1234",
        }

    monkeypatch.setattr("robotick_cli.studio.fetch_studio_hub_json", fake_fetch)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["studio-1234", "diagnostics", "status"],
    )

    assert result.exit_code == 0
    assert captured["path"] == "/v1/studio/instances/studio-1234/diagnostics/status"
    assert captured["output"] == {
        "resource_type": "studio_diagnostics_status",
        "instance_id": "studio-1234",
    }


def test_instance_diagnostics_renderer_queries_hub_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    def fake_fetch(_workspace, path):
        captured["path"] = path
        return {
            "resource_type": "studio_diagnostics_renderer",
            "instance_id": "studio-1234",
        }

    monkeypatch.setattr("robotick_cli.studio.fetch_studio_hub_json", fake_fetch)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["studio-1234", "diagnostics", "renderer"],
    )

    assert result.exit_code == 0
    assert captured["path"] == "/v1/studio/instances/studio-1234/diagnostics/renderer"
    assert captured["output"] == {
        "resource_type": "studio_diagnostics_renderer",
        "instance_id": "studio-1234",
    }


def test_instance_diagnostics_fetch_check_queries_hub_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    def fake_fetch(_workspace, path):
        captured["path"] = path
        return {
            "resource_type": "studio_diagnostics_fetch_check",
            "instance_id": "studio-1234",
        }

    monkeypatch.setattr("robotick_cli.studio.fetch_studio_hub_json", fake_fetch)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["studio-1234", "diagnostics", "fetch-check"],
    )

    assert result.exit_code == 0
    assert captured["path"] == "/v1/studio/instances/studio-1234/diagnostics/fetch-check"
    assert captured["output"] == {
        "resource_type": "studio_diagnostics_fetch_check",
        "instance_id": "studio-1234",
    }


def test_instance_diagnostics_telemetry_queries_hub_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    def fake_fetch(_workspace, path):
        captured["path"] = path
        return {
            "resource_type": "studio_diagnostics_telemetry",
            "instance_id": "studio-1234",
        }

    monkeypatch.setattr("robotick_cli.studio.fetch_studio_hub_json", fake_fetch)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["studio-1234", "diagnostics", "telemetry"],
    )

    assert result.exit_code == 0
    assert captured["path"] == "/v1/studio/instances/studio-1234/diagnostics/telemetry"
    assert captured["output"] == {
        "resource_type": "studio_diagnostics_telemetry",
        "instance_id": "studio-1234",
    }


def test_instance_telemetry_models_queries_hub_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    def fake_fetch(_workspace, path):
        captured["path"] = path
        return {
            "resource_type": "robotick_studio_telemetry_models",
            "models": [{"model_id": "barr-e-face"}],
        }

    monkeypatch.setattr("robotick_cli.studio.fetch_studio_hub_json", fake_fetch)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["studio-1234", "telemetry", "models"],
    )

    assert result.exit_code == 0
    assert captured["path"] == "/v1/studio/instances/studio-1234/telemetry/models"
    assert captured["output"] == {
        "resource_type": "robotick_studio_telemetry_models",
        "models": [{"model_id": "barr-e-face"}],
    }


@pytest.mark.parametrize(
    ("action", "resource_type"),
    [
        ("layout", "robotick_studio_telemetry_model_layout"),
        ("snapshot", "robotick_studio_telemetry_model_snapshot"),
    ],
)
def test_instance_telemetry_model_json_commands_query_hub_endpoint(
    monkeypatch: pytest.MonkeyPatch,
    action: str,
    resource_type: str,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    def fake_fetch(_workspace, path):
        captured["path"] = path
        return {
            "resource_type": resource_type,
            "model": {"model_id": "barr-e-face"},
        }

    monkeypatch.setattr("robotick_cli.studio.fetch_studio_hub_json", fake_fetch)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["studio-1234", "telemetry", "model", "barr-e-face", action],
    )

    assert result.exit_code == 0
    assert (
        captured["path"]
        == f"/v1/studio/instances/studio-1234/telemetry/models/barr-e-face/{action}"
    )
    assert captured["output"] == {
        "resource_type": resource_type,
        "model": {"model_id": "barr-e-face"},
    }


def test_instance_telemetry_raw_buffer_writes_output_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}
    output_path = tmp_path / "face.raw"

    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    def fake_fetch(_workspace, path):
        captured["path"] = path
        return b"\x01\x02\x03"

    monkeypatch.setattr("robotick_cli.studio.fetch_studio_hub_bytes", fake_fetch)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        [
            "studio-1234",
            "telemetry",
            "model",
            "barr-e-face",
            "raw-buffer",
            "--output",
            str(output_path),
        ],
    )

    assert result.exit_code == 0
    assert (
        captured["path"]
        == "/v1/studio/instances/studio-1234/telemetry/models/barr-e-face/raw-buffer"
    )
    assert output_path.read_bytes() == b"\x01\x02\x03"
    assert captured["output"] == {
        "resource_type": "robotick_studio_telemetry_raw_buffer_file",
        "model_id": "barr-e-face",
        "output_path": str(output_path),
        "byte_length": 3,
    }


def test_instance_telemetry_raw_buffer_requires_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    with pytest.raises(CliError) as exc:
        robotick_cli.studio.run_studio_command(
            AppContext(workspace_root=workspace),
            ["studio-1234", "telemetry", "model", "barr-e-face", "raw-buffer"],
        )

    assert exc.value.code == "invalid_arguments"
    assert "raw-buffer --output <path>" in str(exc.value)


@pytest.mark.parametrize(
    ("args", "expected_path", "resource_type"),
    [
        (
            ["console"],
            "/v1/studio/instances/studio-1234/diagnostics/console",
            "studio_diagnostics_console",
        ),
        (
            ["dom", "summary"],
            "/v1/studio/instances/studio-1234/diagnostics/dom/summary",
            "studio_diagnostics_dom_summary",
        ),
        (
            ["dom", "query", "[data-project-picker]"],
            "/v1/studio/instances/studio-1234/diagnostics/dom/query?selector=%5Bdata-project-picker%5D",
            "studio_diagnostics_dom_query",
        ),
        (
            ["css", "query", "[data-project-picker]", "--properties", "display,visibility"],
            "/v1/studio/instances/studio-1234/diagnostics/css/query?selector=%5Bdata-project-picker%5D&properties=display%2Cvisibility",
            "studio_diagnostics_css_query",
        ),
        (
            [
                "screenshot",
                "--window",
                "main",
                "--resource-path",
                "windows/main/workbenches/remote-control",
                "--wait-for-render",
                "--wait-for-telemetry",
                "--validate",
            ],
            "/v1/studio/instances/studio-1234/diagnostics/screenshot?window=main&resource_path=windows%2Fmain%2Fworkbenches%2Fremote-control&wait_for_render=true&wait_for_telemetry=true&validate=true",
            "studio_diagnostics_screenshot",
        ),
        (
            ["snapshot"],
            "/v1/studio/instances/studio-1234/diagnostics/snapshot",
            "studio_diagnostics_snapshot",
        ),
    ],
)
def test_instance_diagnostics_extended_surface_queries_hub_endpoint(
    monkeypatch: pytest.MonkeyPatch,
    args: list[str],
    expected_path: str,
    resource_type: str,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    def fake_fetch(_workspace, path):
        captured["path"] = path
        return {
            "resource_type": resource_type,
            "instance_id": "studio-1234",
        }

    monkeypatch.setattr("robotick_cli.studio.fetch_studio_hub_json", fake_fetch)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["studio-1234", "diagnostics", *args],
    )

    assert result.exit_code == 0
    assert captured["path"] == expected_path
    assert captured["output"] == {
        "resource_type": resource_type,
        "instance_id": "studio-1234",
    }


def test_instance_diagnostics_snapshot_adds_remote_control_runtime_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    monkeypatch.setattr(
        "robotick_cli.studio.fetch_studio_hub_json",
        lambda _workspace, _path: {
            "resource_type": "studio_diagnostics_snapshot",
            "instance_id": "studio-1234",
            "status": {"active_workbench_id": "remote-control"},
            "telemetry": {"model_health": []},
        },
    )
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["studio-1234", "diagnostics", "snapshot"],
    )

    assert result.exit_code == 0
    assert captured["output"]["cli_hints"] == [
        {
            "code": "remote_control_runtime_not_confirmed",
            "message": (
                "Studio is showing Remote Control, but diagnostics has no live telemetry model health. "
                "Use `robotick launcher status` or `robotick launcher wait-ready --project <project>` "
                "to confirm the robot runtime is launched and ready."
            ),
        }
    ]


def test_instance_diagnostics_requires_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint=None,
        ),
    )

    with pytest.raises(CliError) as error:
        robotick_cli.studio.run_studio_command(
            AppContext(workspace_root=workspace),
            ["studio-1234", "diagnostics", "endpoints"],
        )

    assert error.value.code == "studio_control_unavailable"
    assert "does not expose the Studio control service" in str(error.value)


def test_instance_select_project_requires_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint=None,
        ),
    )

    with pytest.raises(CliError) as error:
        robotick_cli.studio.run_studio_command(
            AppContext(workspace_root=workspace),
            ["studio-1234", "select-project", "barr-e"],
        )

    assert error.value.code == "studio_control_unavailable"
    assert "does not expose the Studio control service" in str(error.value)


def test_instance_activate_posts_current_studio_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )

    def fake_post(_workspace, path, payload=None):
        captured["path"] = path
        captured["payload"] = payload
        return {
            "accepted": True,
            "changed": True,
            "activated_path": ["windows", "main", "workbenches", "home"],
            "previous_active_path": None,
            "message": "Activated Studio resource.",
        }

    monkeypatch.setattr("robotick_cli.studio.post_studio_hub_json", fake_post)
    monkeypatch.setattr(
        "robotick_cli.studio.write_json",
        lambda payload: captured.__setitem__("output", payload),
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["studio-1234", "windows", "main", "workbenches", "home", "activate"],
    )

    assert result.exit_code == 0
    assert captured["path"] == "/v1/studio/instances/studio-1234/windows/main/workbenches/home/activate"
    assert captured["payload"] is None
    assert captured["output"] == {
        "accepted": True,
        "changed": True,
        "activated_path": ["windows", "main", "workbenches", "home"],
        "previous_active_path": None,
        "message": "Activated Studio resource.",
    }


def test_instance_activate_requires_control_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr(
        "robotick_cli.studio.get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint=None,
        ),
    )

    with pytest.raises(CliError) as error:
        robotick_cli.studio.run_studio_command(
            AppContext(workspace_root=workspace),
            ["studio-1234", "windows", "main", "activate"],
        )

    assert error.value.code == "studio_control_unavailable"
    assert "does not expose the Studio control service" in str(error.value)


def test_instance_status_returns_structured_payload() -> None:
    workspace = create_fake_workspace()
    with fake_studio_control_server(studio_status_fixture()) as endpoint:
        with live_studio_instance(workspace, control_endpoint=endpoint):
            with managed_headless_hub(workspace):
                result = run_cli(["studio", "studio-1234", "status"], workspace)

                assert result.returncode == 0
                payload = json.loads(result.stdout)
                assert payload["resource_type"] == "studio_instance"
                assert payload["id"] == "studio-1234"
                assert payload["project_name"] == "barr-e"
                assert payload["state_sources"]["active_window_id"] == "live"
                assert payload["children"]["windows"][0]["id"] == "main"
                assert payload["child_collections"][0]["name"] == "windows"
                assert payload["child_collections"][0]["resource_type"] == "studio_windows"


def test_deep_studio_navigation_and_status_work_in_repl() -> None:
    workspace = create_fake_workspace()
    with fake_studio_control_server(studio_status_fixture()) as endpoint:
        with live_studio_instance(workspace, control_endpoint=endpoint):
            with managed_headless_hub(workspace):
                result = run_shell(
                    [
                        "studio",
                        "cd studio-1234",
                        "status",
                        "cd windows",
                        "ls",
                        "cd main",
                        "cd workbenches",
                        "cd remote-control",
                        "cd layouts",
                        "cd main:remote-control:default",
                        "status",
                        "cd panels",
                        "cd panel-face-preview",
                        "status",
                        "exit",
                    ],
                    workspace,
                )

                assert result.returncode == 0
                assert '"resource_type": "studio_instance"' in result.stdout
                assert "robotick:studio:studio-1234" in result.stdout
                assert "Contexts:\n- main/\n- child-window-1/" in result.stdout
                assert '"resource_type": "studio_layout"' in result.stdout
                assert '"id": "main:remote-control:default"' in result.stdout
                assert '"resource_type": "studio_panel"' in result.stdout
                assert '"id": "panel-face-preview"' in result.stdout


def test_repl_cd_then_activate_targets_current_studio_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}
    inputs = iter(
        [
            "studio",
            "studio-1234",
            "cd windows",
            "cd main",
            "cd workbenches",
            "cd home",
            "activate",
            "exit",
        ]
    )

    def fake_node_status(
        _workspace: Path,
        _instance_name: str,
        path_segments: tuple[str, ...] = (),
    ) -> dict[str, object]:
        nodes = {
            (): {"child_collections": [{"name": "windows"}]},
            ("windows",): {"child_resources": [{"id": "main"}]},
            ("windows", "main"): {"child_collections": [{"name": "workbenches"}]},
            ("windows", "main", "workbenches"): {"child_resources": [{"id": "home"}]},
            ("windows", "main", "workbenches", "home"): {
                "activation_target_path": ["windows", "main", "workbenches", "home"],
                "child_collections": [],
            },
        }
        return nodes[path_segments]

    def fake_run_studio_command(_ctx: AppContext, args: list[str]) -> CommandResult:
        captured["args"] = args
        return CommandResult(exit_code=0)

    monkeypatch.setattr(repl_module, "ensure_hub", lambda _workspace: None)
    monkeypatch.setattr(
        repl_module,
        "install_readline_completion",
        lambda _ctx, _state: (lambda: None),
    )
    monkeypatch.setattr(
        repl_module,
        "get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )
    monkeypatch.setattr(repl_module, "fetch_studio_node_status", fake_node_status)
    monkeypatch.setattr(repl_module, "run_studio_command", fake_run_studio_command)
    monkeypatch.setattr(repl_module, "reconcile_bound_instance", lambda _workspace, _state: None)
    monkeypatch.setattr("builtins.input", lambda _prompt: next(inputs))
    monkeypatch.setattr(repl_module, "write", lambda _text, stream=None: None)
    monkeypatch.setattr(repl_module, "writeln", lambda _text="", stream=None: None)

    exit_code = start_interactive_shell(AppContext(workspace_root=workspace))

    assert exit_code == 0
    assert captured["args"] == [
        "studio-1234",
        "windows",
        "main",
        "workbenches",
        "home",
        "activate",
    ]


def test_repl_back_updates_current_studio_path_before_activate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}
    inputs = iter(
        [
            "studio",
            "studio-1234",
            "cd windows",
            "cd main",
            "cd workbenches",
            "cd home",
            "back",
            "activate",
            "exit",
        ]
    )

    def fake_node_status(
        _workspace: Path,
        _instance_name: str,
        path_segments: tuple[str, ...] = (),
    ) -> dict[str, object]:
        nodes = {
            (): {"child_collections": [{"name": "windows"}]},
            ("windows",): {"child_resources": [{"id": "main"}]},
            ("windows", "main"): {"child_collections": [{"name": "workbenches"}]},
            ("windows", "main", "workbenches"): {
                "activation_target_path": ["windows", "main"],
                "child_resources": [{"id": "home"}],
            },
            ("windows", "main", "workbenches", "home"): {
                "activation_target_path": ["windows", "main", "workbenches", "home"],
                "child_collections": [],
            },
        }
        return nodes[path_segments]

    def fake_run_studio_command(_ctx: AppContext, args: list[str]) -> CommandResult:
        captured["args"] = args
        return CommandResult(exit_code=0)

    monkeypatch.setattr(repl_module, "ensure_hub", lambda _workspace: None)
    monkeypatch.setattr(
        repl_module,
        "install_readline_completion",
        lambda _ctx, _state: (lambda: None),
    )
    monkeypatch.setattr(
        repl_module,
        "get_live_instance",
        lambda _workspace, name: InstanceRecord(
            name=name,
            pid=os.getpid(),
            mode="dev",
            started_at="2026-06-06T12:00:00+00:00",
            control_endpoint="http://127.0.0.1:7123",
        ),
    )
    monkeypatch.setattr(repl_module, "fetch_studio_node_status", fake_node_status)
    monkeypatch.setattr(repl_module, "run_studio_command", fake_run_studio_command)
    monkeypatch.setattr(repl_module, "reconcile_bound_instance", lambda _workspace, _state: None)
    monkeypatch.setattr("builtins.input", lambda _prompt: next(inputs))
    monkeypatch.setattr(repl_module, "write", lambda _text, stream=None: None)
    monkeypatch.setattr(repl_module, "writeln", lambda _text="", stream=None: None)

    exit_code = start_interactive_shell(AppContext(workspace_root=workspace))

    assert exit_code == 0
    assert captured["args"] == [
        "studio-1234",
        "windows",
        "main",
        "workbenches",
        "activate",
    ]


def test_one_shot_deep_layout_and_panel_status() -> None:
    workspace = create_fake_workspace()
    with fake_studio_control_server(studio_status_fixture()) as endpoint:
        with live_studio_instance(workspace, control_endpoint=endpoint):
            with managed_headless_hub(workspace):
                layout_result = run_cli(
                    [
                        "studio",
                        "studio-1234",
                        "windows",
                        "main",
                        "workbenches",
                        "remote-control",
                        "layouts",
                        "main:remote-control:default",
                        "status",
                    ],
                    workspace,
                )
                panel_result = run_cli(
                    [
                        "studio",
                        "studio-1234",
                        "windows",
                        "main",
                        "workbenches",
                        "remote-control",
                        "layouts",
                        "main:remote-control:default",
                        "panels",
                        "panel-face-preview",
                        "status",
                    ],
                    workspace,
                )

                assert layout_result.returncode == 0
                assert panel_result.returncode == 0
                layout_payload = json.loads(layout_result.stdout)
                panel_payload = json.loads(panel_result.stdout)
                assert layout_payload["resource_type"] == "studio_layout"
                assert layout_payload["id"] == "main:remote-control:default"
                assert layout_payload["diagnostics"]["source"] == "computed"
                assert layout_payload["diagnostics"]["items"] == []
                assert panel_payload["resource_type"] == "studio_panel"
                assert panel_payload["id"] == "panel-face-preview"
                assert panel_payload["settings"]["source"] == "face-camera"
                assert panel_payload["diagnostics"]["source"] == "placeholder"
                assert panel_payload["diagnostics"]["items"] == []


def test_one_shot_window_and_workbench_status() -> None:
    workspace = create_fake_workspace()
    with fake_studio_control_server(studio_status_fixture()) as endpoint:
        with live_studio_instance(workspace, control_endpoint=endpoint):
            with managed_headless_hub(workspace):
                window_result = run_cli(
                    ["studio", "studio-1234", "windows", "main", "status"],
                    workspace,
                )
                workbench_result = run_cli(
                    [
                        "studio",
                        "studio-1234",
                        "windows",
                        "main",
                        "workbenches",
                        "remote-control",
                        "status",
                    ],
                    workspace,
                )

                assert window_result.returncode == 0
                assert workbench_result.returncode == 0
                window_payload = json.loads(window_result.stdout)
                workbench_payload = json.loads(workbench_result.stdout)
                assert window_payload["resource_type"] == "studio_window"
                assert window_payload["id"] == "main"
                assert window_payload["state_sources"]["active_workbench_id"] == "live"
                assert window_payload["children"]["workbenches"][0]["id"] == "remote-control"
                assert workbench_payload["resource_type"] == "studio_workbench"
                assert workbench_payload["id"] == "remote-control"
                assert workbench_payload["active_layout_id"] == "main:remote-control:default"
                assert workbench_payload["state_sources"]["active_layout_id"] == "live"
                assert workbench_payload["children"]["layouts"][0]["id"] == "main:remote-control:default"


def test_invalid_deep_studio_context_fails_clearly() -> None:
    workspace = create_fake_workspace()
    with fake_studio_control_server(studio_status_fixture()) as endpoint:
        with live_studio_instance(workspace, control_endpoint=endpoint):
            with managed_headless_hub(workspace):
                result = run_cli(
                    [
                        "studio",
                        "studio-1234",
                        "windows",
                        "missing-window",
                        "status",
                    ],
                    workspace,
                )

                assert result.returncode == 1
                payload = json.loads(result.stderr)
                assert payload["error"]["code"] == "unknown_studio_context"
                assert payload["error"]["message"] == "Unknown Studio context: missing-window"


def test_studio_status_without_bound_instance_fails_with_guidance() -> None:
    workspace = create_fake_workspace()

    result = run_cli(["studio", "status"], workspace)

    assert result.returncode == 1
    payload = json.loads(result.stderr)
    assert payload["error"]["code"] == "studio_instance_not_bound"
    assert "No Studio instance is currently bound." in payload["error"]["message"]
    assert "robotick studio open [project]" in payload["error"]["recovery"]


def test_fetch_active_studio_path_reads_active_workbench_from_window_node(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured_paths: list[tuple[str, ...]] = []

    def fake_fetch_status(_workspace, _instance_name, path_segments):
        captured_paths.append(tuple(path_segments))
        if tuple(path_segments) == ():
            return {"active_window_id": "main"}
        if tuple(path_segments) == ("windows", "main"):
            return {"active_workbench_id": "remote-control"}
        raise AssertionError(f"unexpected path: {path_segments}")

    monkeypatch.setattr("robotick_cli.studio.fetch_studio_node_status", fake_fetch_status)

    assert robotick_cli.studio.fetch_active_studio_path(
        AppContext(workspace_root=workspace),
        "studio-1234",
    ) == ["windows", "main", "workbenches", "remote-control"]
    assert captured_paths == [(), ("windows", "main")]


def test_open_with_unknown_project_returns_json_error() -> None:
    workspace = create_fake_workspace()

    result = run_cli(["studio", "open", "unknown-project"], workspace)

    assert result.returncode == 1
    payload = json.loads(result.stderr)
    assert payload["error"]["code"] == "unknown_project"
    assert "Unknown project: unknown-project." in payload["error"]["message"]
    assert "robotick studio projects" in payload["error"]["recovery"]


def test_open_without_project_returns_json_result() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["studio", "open"], workspace)

    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["resource_type"] == "robotick_studio_open_result"
    assert payload["project_name"] is None
    assert payload["instance"]["name"].startswith("studio-")
    assert payload["control_service"]["state"] == "not_waited"
    assert payload["control_handles"]["instance_command_prefix"] == [
        "robotick",
        "studio",
        payload["instance"]["name"],
    ]
    assert payload["control_handles"]["window_command_prefix"] == [
        "robotick",
        "studio",
        payload["instance"]["name"],
    ]
    assert payload["notes"] == [
        "Use the instance command prefix to control this Studio instance.",
        "Running 'robotick studio open ...' again creates a separate Studio instance.",
    ]
    assert payload["support"]["hub"]["action"] in {"started", "reused", "restarted"}
    assert payload["support"]["launcher_service"]["action"] in {"started", "reused", "restarted"}
    logs_dir = workspace / ".robotick" / "logs"
    assert any(name.name.startswith("studio-open-empty-") for name in logs_dir.iterdir())


def test_studio_open_can_chain_into_instance_activation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    captured: dict[str, object] = {}

    monkeypatch.setattr("robotick_cli.studio.determine_hub_action", lambda _workspace: "reused")

    def fake_post_studio_hub_json(_workspace, path, payload=None):
        if path == "/v1/studio/open":
            return {
                "instance": {
                    "name": "studio-2222",
                    "pid": 2222,
                    "mode": "dev",
                    "started_at": "2026-06-06T12:00:00+00:00",
                    "state": "running",
                    "project_name": "barr-e",
                    "log_path": str(workspace / ".robotick" / "logs" / "studio-open-barr-e.log"),
                    "control_endpoint": None,
                },
                "support": {"launcher_service": {"action": "reused"}},
            }
        captured["activation"] = {"path": path, "payload": payload}
        return {
            "accepted": True,
            "changed": True,
            "activated_path": ["windows", "main", "workbenches", "terminal"],
            "previous_active_path": ["windows", "main", "workbenches", "home"],
            "message": "Activated Studio resource.",
        }

    monkeypatch.setattr("robotick_cli.studio.post_studio_hub_json", fake_post_studio_hub_json)
    monkeypatch.setattr("robotick_cli.studio.write_json", lambda payload: captured.__setitem__("result_payload", payload))
    monkeypatch.setattr(
        "robotick_cli.studio.wait_for_studio_control",
        lambda _ctx, instance_name, _timeout_seconds=None: {
            "state": "ready",
            "endpoint": "http://127.0.0.1:7123",
            "active_path": ["windows", "main", "workbenches", "home"],
            "instance": {
                "name": instance_name,
                "pid": 2222,
                "mode": "dev",
                "started_at": "2026-06-06T12:00:00+00:00",
                "state": "running",
                "project_name": "barr-e",
                "control_endpoint": "http://127.0.0.1:7123",
            },
        },
    )

    result = robotick_cli.studio.run_studio_command(
        AppContext(workspace_root=workspace),
        ["open", "barr-e", "windows", "main", "workbenches", "terminal", "activate"],
    )

    assert result.exit_code == 0
    assert result.opened_instance_name == "studio-2222"
    payload = captured["result_payload"]
    assert payload["resource_type"] == "robotick_studio_open_chained_result"
    assert payload["control_handles"]["instance_command_prefix"] == [
        "robotick",
        "studio",
        "studio-2222",
    ]
    assert payload["control_handles"]["window_command_prefix"] == [
        "robotick",
        "studio",
        "studio-2222",
        "windows",
        "main",
        "workbenches",
        "home",
    ]
    assert captured["activation"] == {
        "path": "/v1/studio/instances/studio-2222/windows/main/workbenches/terminal/activate",
        "payload": None,
    }


def test_studio_open_restarts_stale_hub_when_new_route_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    old_record = HubRecord(endpoint="http://127.0.0.1:7000", pid=111, workspace_root=str(workspace))
    fresh_record = HubRecord(endpoint="http://127.0.0.1:7001", pid=222, workspace_root=str(workspace))
    state = {"restarted": 0}

    monkeypatch.setattr("robotick_cli.studio.ensure_hub", lambda _workspace: old_record if state["restarted"] == 0 else fresh_record)

    def fake_post(record, path, payload=None):
        if record.endpoint == old_record.endpoint:
            raise hub_client_module.HubRequestError("robotick-hub request failed: 404 Not Found", status_code=404)
        return {
            "instance": {
                "name": "studio-2222",
                "pid": 2222,
                "mode": "dev",
                "started_at": "2026-06-06T12:00:00+00:00",
                "state": "running",
                "project_name": None,
                "log_path": str(workspace / ".robotick" / "logs" / "studio-open-empty.log"),
                "control_endpoint": None,
            },
            "support": {"launcher_service": {"action": "started"}},
        }

    monkeypatch.setattr("robotick_cli.studio.post_hub_json", fake_post)
    monkeypatch.setattr("robotick_cli.studio.restart_hub", lambda _workspace: state.__setitem__("restarted", state["restarted"] + 1) or fresh_record)
    monkeypatch.setattr(
        "robotick_cli.studio.wait_for_studio_control",
        lambda _ctx, _instance_name, _timeout_seconds=None: {"state": "not_waited", "endpoint": None},
    )

    result = robotick_cli.studio.run_studio_command(AppContext(workspace_root=workspace), ["open"])
    assert result.exit_code == 0
    assert result.opened_instance_name == "studio-2222"
    assert state["restarted"] == 1


def test_activate_retries_when_runtime_state_does_not_apply_on_first_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    calls = {"activations": 0}

    def fake_post(_workspace, path, payload=None):
        calls["activations"] += 1
        return {
            "accepted": True,
            "changed": True,
            "activated_path": ["windows", "main", "workbenches", "telemetry"],
            "previous_active_path": ["windows", "main", "workbenches", "home"],
            "message": "Activated Studio resource.",
        }

    def fake_status(_workspace, _instance_name, path_segments):
        if path_segments == ("windows", "main", "workbenches", "telemetry"):
            return {"active": calls["activations"] >= 2}
        raise AssertionError(f"Unexpected status path: {path_segments}")

    monkeypatch.setattr("robotick_cli.studio.post_studio_hub_json", fake_post)
    monkeypatch.setattr("robotick_cli.studio.fetch_studio_node_status", fake_status)
    monkeypatch.setattr(
        "robotick_cli.studio.activation_settle_timeout_seconds",
        lambda: 0.0,
    )

    payload = robotick_cli.studio.activate_opened_studio_resource(
        AppContext(workspace_root=workspace),
        "studio-1234",
        ("windows", "main", "workbenches", "telemetry"),
    )

    assert calls["activations"] == 2
    assert payload["accepted"] is True
    assert payload["activated_path"] == [
        "windows",
        "main",
        "workbenches",
        "telemetry",
    ]


def test_studio_quit_falls_back_when_hub_request_times_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr(
        "robotick_cli.studio.post_studio_hub_json",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            hub_client_module.HubRequestError("Unable to reach robotick-hub at http://127.0.0.1:7000")
        ),
    )
    monkeypatch.setattr(
        "robotick_cli.studio.quit_studio_instance",
        lambda _workspace, instance_name: (True, f"Studio instance {instance_name} closed."),
    )
    result = robotick_cli.studio.handle_instance_quit(
        AppContext(workspace_root=workspace),
        "studio-2222",
        [],
    )
    assert result.exit_code == 0


def test_studio_quit_waits_until_instance_is_gone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    calls = {"waited": 0}
    monkeypatch.setattr(
        "robotick_cli.studio.post_studio_hub_json",
        lambda *_args, **_kwargs: {
            "accepted": True,
            "message": "Studio instance studio-2222 close requested.",
        },
    )

    def fake_wait(_workspace, instance_name):
        calls["waited"] += 1
        assert instance_name == "studio-2222"
        return True

    monkeypatch.setattr("robotick_cli.studio.wait_for_studio_instance_gone", fake_wait)
    result = robotick_cli.studio.handle_instance_quit(
        AppContext(workspace_root=workspace),
        "studio-2222",
        ["--wait"],
    )

    assert result.exit_code == 0
    assert calls["waited"] == 1


def test_studio_quit_wait_times_out_when_instance_remains_live(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    monkeypatch.setattr(
        "robotick_cli.studio.post_studio_hub_json",
        lambda *_args, **_kwargs: {
            "accepted": True,
            "message": "Studio instance studio-2222 close requested.",
        },
    )
    monkeypatch.setattr("robotick_cli.studio.wait_for_studio_instance_gone", lambda *_args: False)

    result = robotick_cli.studio.handle_instance_quit(
        AppContext(workspace_root=workspace),
        "studio-2222",
        ["--wait"],
    )

    assert result.exit_code == 1


def test_create_without_project_launches_empty_studio_quietly() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["studio", "create"], workspace)

    assert result.returncode == 0
    assert "Opening Robotick Studio..." in result.stdout
    assert "Studio launch started." in result.stdout
    assert "Instance: studio-" in result.stdout


def test_open_with_project_launches_project_quietly() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["studio", "open", "barr-e"], workspace)

    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["resource_type"] == "robotick_studio_open_result"
    assert payload["project_name"] == "barr-e"
    assert payload["instance"]["name"].startswith("studio-")
    assert payload["control_handles"]["instance_command_prefix"] == [
        "robotick",
        "studio",
        payload["instance"]["name"],
    ]
    assert payload["support"]["hub"]["action"] in {"started", "reused", "restarted"}
    assert payload["support"]["launcher_service"]["action"] in {"started", "reused", "restarted"}


def test_instances_list_live_instances_created_by_open() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = opened_instance_name_from_stdout(opened.stdout)

    listed = run_cli(["studio", "instances"], workspace)
    assert listed.returncode == 0
    payload = json.loads(listed.stdout)
    assert payload["resource_type"] == "robotick_studio_instances"
    assert any(item["name"] == instance_name for item in payload["instances"])


def test_one_shot_quit_closes_live_instance_cleanly() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = opened_instance_name_from_stdout(opened.stdout)

    quit_result = run_cli(["studio", instance_name, "quit"], workspace)
    assert quit_result.returncode == 0
    assert (
        f"Studio instance {instance_name} closed." in quit_result.stdout
        or f"Studio instance {instance_name} force-closed after not exiting cleanly." in quit_result.stdout
    )
    wait_for(lambda: not (workspace / ".robotick" / "instances" / f"{instance_name}.json").exists())


def test_one_shot_quit_wait_closes_live_instance_cleanly() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = opened_instance_name_from_stdout(opened.stdout)

    quit_result = run_cli(["studio", instance_name, "quit", "--wait"], workspace)
    assert quit_result.returncode == 0
    assert "Instance is no longer running." in quit_result.stdout
    assert not (workspace / ".robotick" / "instances" / f"{instance_name}.json").exists()


def test_cd_enters_a_discovered_instance_context() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = opened_instance_name_from_stdout(opened.stdout)
    state = ShellState(namespace="studio")
    apply_cd(AppContext(workspace_root=workspace), state, [instance_name])
    assert state == ShellState(namespace="studio", instance_name=instance_name)


def test_direct_instance_entry_works_without_cd() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = opened_instance_name_from_stdout(opened.stdout)
    state = ShellState(namespace="studio")

    entered = try_enter_context_directly(
        AppContext(workspace_root=workspace),
        state,
        [instance_name],
    )

    assert entered is True
    assert state == ShellState(namespace="studio", instance_name=instance_name)


def test_cd_parent_sibling_instance_works() -> None:
    workspace = create_fake_workspace()
    first_opened = run_cli(["studio", "open"], workspace)
    second_opened = run_cli(["studio", "open"], workspace)
    first_instance = opened_instance_name_from_stdout(first_opened.stdout)
    second_instance = opened_instance_name_from_stdout(second_opened.stdout)
    state = ShellState(namespace="studio", instance_name=first_instance)

    apply_cd(AppContext(workspace_root=workspace), state, [f"../{second_instance}"])

    assert state == ShellState(namespace="studio", instance_name=second_instance)


def test_cd_parent_top_level_namespace_works() -> None:
    state = ShellState(namespace="studio")

    apply_cd(AppContext(workspace_root=create_fake_workspace()), state, ["../hub"])

    assert state == ShellState(namespace="hub")


def test_shell_open_composite_binds_new_instance_into_context() -> None:
    state = ShellState(namespace="studio")
    bind_opened_instance_to_state(state, CommandResult(exit_code=0, opened_instance_name="studio-12345"))
    assert state == ShellState(namespace="studio", instance_name="studio-12345")


def test_shell_create_primitive_does_not_bind_without_opened_instance() -> None:
    state = ShellState(namespace="studio")
    bind_opened_instance_to_state(state, CommandResult(exit_code=0))
    assert state == ShellState(namespace="studio")


def test_top_level_studio_open_binds_into_opened_instance_context() -> None:
    state = ShellState()

    bind_top_level_studio_open_to_state(
        state,
        ["studio", "open"],
        CommandResult(exit_code=0, opened_instance_name="studio-12345"),
    )

    assert state == ShellState(namespace="studio", instance_name="studio-12345")


def test_top_level_studio_open_project_uses_same_binding_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = ShellState()
    ctx = AppContext(workspace_root=create_fake_workspace())
    monkeypatch.setattr(
        repl_module,
        "run_studio_command",
        lambda _ctx, _args: CommandResult(exit_code=0, opened_instance_name="studio-56789"),
    )

    entered = try_handle_top_level_studio_open(ctx, state, ["studio", "open", "barr-e"])

    assert entered is True
    assert state == ShellState(namespace="studio", instance_name="studio-56789")


def test_bound_instance_quit_stale_instance_does_not_raise_and_unbinds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    state = ShellState(namespace="studio", instance_name="studio-12345")
    writes: list[str] = []

    def fake_writeln(text: str = "", stream=None) -> None:
        writes.append(text)

    monkeypatch.setattr(
        repl_module,
        "run_studio_command",
        lambda _ctx, _args: (_ for _ in ()).throw(
            repl_module.CliError("Unknown studio command or instance: studio-12345")
        ),
    )
    monkeypatch.setattr(
        repl_module,
        "reconcile_bound_instance",
        lambda _workspace, shell_state: (
            shell_state.__setattr__("instance_name", None) or "Studio instance studio-12345 closed."
        ),
    )
    monkeypatch.setattr(repl_module, "writeln", fake_writeln)

    handle_bound_instance_quit(AppContext(workspace_root=workspace), state)

    assert state == ShellState(namespace="studio", instance_name=None)
    assert "Studio instance studio-12345 closed." in writes


def test_unexpected_command_error_does_not_exit_interactive_shell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    inputs = iter(["studio", "projects", "exit"])
    writes: list[str] = []

    def fake_input(_prompt: str) -> str:
        return next(inputs)

    def fake_write(text: str, stream=None) -> None:
        writes.append(text)

    def fake_writeln(text: str = "", stream=None) -> None:
        writes.append(f"{text}\n")

    monkeypatch.setattr(repl_module, "ensure_hub", lambda _workspace: None)
    monkeypatch.setattr(repl_module, "install_readline_completion", lambda _ctx, _state: (lambda: None))
    monkeypatch.setattr(repl_module, "write", fake_write)
    monkeypatch.setattr(repl_module, "writeln", fake_writeln)
    monkeypatch.setattr("builtins.input", fake_input)
    monkeypatch.setattr(
        repl_module,
        "run_command",
        lambda _ctx, args: (_ for _ in ()).throw(RuntimeError("boom"))
        if args == ["studio", "projects"]
        else CommandResult(exit_code=0),
    )

    exit_code = start_interactive_shell(AppContext(workspace_root=workspace))

    assert exit_code == 0
    captured = "".join(writes)
    assert "Robotick hit an unexpected error while handling that command. The session is still running." in captured
    assert "boom" in captured


def test_back_unwinds_from_instance_context_to_studio_without_leaving_cli() -> None:
    next_state = step_back(ShellState(namespace="studio", instance_name="studio-12345"))
    assert next_state == ShellState(namespace="studio")


def test_back_unwinds_from_nested_studio_context_to_parent_node() -> None:
    next_state = step_back(
        ShellState(
            namespace="studio",
            instance_name="studio-12345",
            studio_path=("windows", "main", "workbenches"),
        )
    )
    assert next_state == ShellState(
        namespace="studio",
        instance_name="studio-12345",
        studio_path=("windows", "main"),
    )


def test_back_unwinds_from_studio_context_to_top_level() -> None:
    next_state = step_back(ShellState(namespace="studio"))
    assert next_state == ShellState()


def test_cd_dot_dot_updates_nested_studio_path() -> None:
    workspace = create_fake_workspace()
    state = ShellState(
        namespace="studio",
        instance_name="studio-12345",
        studio_path=("windows", "main", "workbenches"),
    )

    apply_cd(AppContext(workspace_root=workspace), state, [".."])

    assert state == ShellState(
        namespace="studio",
        instance_name="studio-12345",
        studio_path=("windows", "main"),
    )


def test_prompt_renders_bound_instance_path() -> None:
    assert get_prompt(ShellState(namespace="studio", instance_name="studio-12345")) == "robotick:studio:studio-12345> "


def test_instance_helpers_understand_pid_format() -> None:
    assert parse_instance_pid("studio-12345") == 12345
    assert parse_instance_pid("barr-e") is None


def test_reconcile_bound_instance_clears_stale_context() -> None:
    workspace = create_fake_workspace()
    state = ShellState(namespace="studio", instance_name="studio-12345")
    message = reconcile_bound_instance(workspace, state)
    assert message == "Studio instance studio-12345 closed."
    assert state == ShellState(namespace="studio")


def test_reconcile_bound_instance_uses_hub_backed_instance_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    state = ShellState(namespace="studio", instance_name="studio-12345")
    monkeypatch.setattr(
        "robotick_cli.instances.discover_hub",
        lambda _workspace: HubRecord(endpoint="http://127.0.0.1:7090", pid=1234),
    )
    monkeypatch.setattr(
        "robotick_cli.instances.fetch_hub_json",
        lambda _record, _path: {"instances": []},
    )

    message = reconcile_bound_instance(workspace, state)

    assert message == "Studio instance studio-12345 closed."
    assert state == ShellState(namespace="studio")


def test_interrupts_do_not_exit_interactive_shell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    inputs = iter([KeyboardInterrupt(), "exit"])
    writes: list[str] = []

    def fake_input(_prompt: str) -> str:
        value = next(inputs)
        if isinstance(value, BaseException):
            raise value
        return value

    def fake_write(text: str, stream=None) -> None:
        writes.append(text)

    def fake_writeln(text: str = "", stream=None) -> None:
        writes.append(f"{text}\n")

    monkeypatch.setattr(repl_module, "ensure_hub", lambda _workspace: None)
    monkeypatch.setattr(repl_module, "install_readline_completion", lambda _ctx, _state: (lambda: None))
    monkeypatch.setattr(repl_module, "write", fake_write)
    monkeypatch.setattr(repl_module, "writeln", fake_writeln)
    monkeypatch.setattr("builtins.input", fake_input)

    exit_code = start_interactive_shell(AppContext(workspace_root=workspace))

    assert exit_code == 0
    captured = "".join(writes)
    assert "KeyboardInterrupt" in captured
    assert "Use 'exit' to leave Robotick." in captured


def test_eof_does_not_exit_interactive_shell(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = create_fake_workspace()
    inputs = iter([EOFError(), "exit"])
    writes: list[str] = []

    def fake_input(_prompt: str) -> str:
        value = next(inputs)
        if isinstance(value, BaseException):
            raise value
        return value

    def fake_write(text: str, stream=None) -> None:
        writes.append(text)

    def fake_writeln(text: str = "", stream=None) -> None:
        writes.append(f"{text}\n")

    monkeypatch.setattr(repl_module, "ensure_hub", lambda _workspace: None)
    monkeypatch.setattr(repl_module, "install_readline_completion", lambda _ctx, _state: (lambda: None))
    monkeypatch.setattr(repl_module, "write", fake_write)
    monkeypatch.setattr(repl_module, "writeln", fake_writeln)
    monkeypatch.setattr("builtins.input", fake_input)

    exit_code = start_interactive_shell(AppContext(workspace_root=workspace))

    assert exit_code == 0
    captured = "".join(writes)
    assert "Use 'exit' to leave Robotick." in captured


def test_completion_suggests_studio_instances_for_cd() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = opened_instance_name_from_stdout(opened.stdout)

    matches = get_completion_matches(
        AppContext(workspace_root=workspace),
        ShellState(namespace="studio"),
        "cd stu",
        3,
        6,
    )

    assert f"{instance_name}/" in matches


def test_completion_suggests_instance_quit_in_studio_context() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = opened_instance_name_from_stdout(opened.stdout)

    matches = get_completion_matches(
        AppContext(workspace_root=workspace),
        ShellState(namespace="studio"),
        f"{instance_name} q",
        len(instance_name) + 1,
        len(instance_name) + 2,
    )

    assert "quit" in matches


def test_completion_suggests_instance_status_in_studio_context() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = opened_instance_name_from_stdout(opened.stdout)

    matches = get_completion_matches(
        AppContext(workspace_root=workspace),
        ShellState(namespace="studio"),
        f"{instance_name} s",
        len(instance_name) + 1,
        len(instance_name) + 2,
    )

    assert "status" in matches


def test_discover_hub_reads_registry_record() -> None:
    workspace = create_fake_workspace()
    record_path = get_hub_record_path(workspace)
    record_path.parent.mkdir(parents=True, exist_ok=True)
    record_path.write_text(
        HubRecord(endpoint="http://127.0.0.1:7090", pid=1234, workspace_root=str(workspace)).model_dump_json(),
        encoding="utf-8",
    )
    record = discover_hub(workspace)
    assert record is not None
    assert record.endpoint == "http://127.0.0.1:7090"


def test_hub_compatibility_requires_current_protocol_and_features() -> None:
    assert is_hub_compatible(compatible_hub_health()) is True
    assert is_hub_compatible({"status": "ok"}) is False
    assert is_hub_compatible(
        {
            "status": "ok",
            "api_version": hub_client_module.REQUIRED_HUB_API_VERSION,
            "features": ["hub_health_protocol"],
        }
    ) is False


def test_desktop_tray_expected_honors_headless_and_desktop_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    monkeypatch.delenv("ROBOTICK_HUB_FORCE_HEADLESS", raising=False)
    monkeypatch.delenv("ROBOTICK_HUB_FORCE_TRAY", raising=False)
    assert desktop_tray_expected() is False
    monkeypatch.setenv("DISPLAY", ":0")
    assert desktop_tray_expected() is True
    monkeypatch.setenv("ROBOTICK_HUB_FORCE_HEADLESS", "1")
    assert desktop_tray_expected() is False


def test_ensure_hub_replaces_non_tray_hub_in_desktop_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = create_fake_workspace()
    stale = HubRecord(endpoint="http://127.0.0.1:7000", pid=111)
    fresh = HubRecord(endpoint="http://127.0.0.1:7001", pid=222)
    state = {"discover_calls": 0, "stopped": [], "started": 0}

    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.delenv("ROBOTICK_HUB_FORCE_HEADLESS", raising=False)

    def fake_discover(_workspace):
        state["discover_calls"] += 1
        if state["discover_calls"] == 1:
            return stale
        return fresh

    def fake_is_pid_alive(pid):
        return pid in {111, 222}

    def fake_fetch(record, path):
        assert path == "/v1/health"
        if record.pid == 111:
            return {**compatible_hub_health(tray_active=False)}
        return {**compatible_hub_health(tray_active=True)}

    monkeypatch.setattr(hub_client_module, "discover_hub", fake_discover)
    monkeypatch.setattr(hub_client_module, "is_pid_alive", fake_is_pid_alive)
    monkeypatch.setattr(hub_client_module, "fetch_hub_json", fake_fetch)
    monkeypatch.setattr(hub_client_module, "start_hub", lambda _workspace: state.__setitem__("started", state["started"] + 1))
    monkeypatch.setattr(hub_client_module, "stop_hub_process", lambda pid: state["stopped"].append(pid))

    record = ensure_hub(workspace)
    assert record.pid == 222
    assert state["stopped"] == [111]
    assert state["started"] == 1


def test_ensure_hub_replaces_old_incompatible_hub(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace = create_fake_workspace()
    old = HubRecord(endpoint="http://127.0.0.1:7000", pid=111)
    fresh = HubRecord(endpoint="http://127.0.0.1:7001", pid=222)
    state = {"discover_calls": 0, "stopped": [], "started": 0}

    monkeypatch.setenv("ROBOTICK_HUB_FORCE_HEADLESS", "1")

    def fake_discover(_workspace):
        state["discover_calls"] += 1
        if state["discover_calls"] == 1:
            return old
        return fresh

    def fake_fetch(record, path):
        assert path == "/v1/health"
        if record.pid == 111:
            return {"status": "ok"}
        return compatible_hub_health()

    monkeypatch.setattr(hub_client_module, "discover_hub", fake_discover)
    monkeypatch.setattr(hub_client_module, "is_pid_alive", lambda pid: pid in {111, 222})
    monkeypatch.setattr(hub_client_module, "fetch_hub_json", fake_fetch)
    monkeypatch.setattr(
        hub_client_module,
        "start_hub",
        lambda _workspace: state.__setitem__("started", state["started"] + 1),
    )
    monkeypatch.setattr(
        hub_client_module,
        "stop_hub_process",
        lambda pid: state["stopped"].append(pid),
    )

    record = ensure_hub(workspace)

    assert record.pid == 222
    assert state["stopped"] == [111]
    assert state["started"] == 1


def test_select_hub_python_executable_requires_pyqt5_in_managed_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.delenv("ROBOTICK_HUB_FORCE_HEADLESS", raising=False)
    monkeypatch.setattr(hub_client_module, "python_supports_module", lambda executable, module: executable == sys.executable and module == "PyQt5")
    assert hub_client_module.select_hub_python_executable() == sys.executable
