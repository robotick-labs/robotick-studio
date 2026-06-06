from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

import pytest

from robotick_cli.app.context import AppContext, ShellState
from robotick_cli.hub_client import HubRecord, discover_hub, get_hub_record_path
from robotick_cli.instances import parse_instance_pid, reconcile_bound_instance
from robotick_cli.interfaces.repl import apply_cd, bind_opened_instance_to_state, step_back
from robotick_cli.language.help import format_shell_context, get_prompt, get_studio_help_text
from robotick_cli.language.registry import get_studio_command_spec
from robotick_cli.studio import CommandResult


CLI_DIR = Path(__file__).resolve().parents[1]
CLI_SRC = CLI_DIR / "src"
HUB_DIR = CLI_DIR.parent / "robotick-hub"


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
                "    launch_script: robots/barr-e/run-studio.sh",
                "",
            ]
        ),
        encoding="utf-8",
    )
    write_executable(
        studio_root / "run-studio-dev.sh",
        "#!/usr/bin/env bash\nset -euo pipefail\nsleep 30\n",
    )
    write_executable(
        root / "robots" / "barr-e" / "run-studio.sh",
        "#!/usr/bin/env bash\nset -euo pipefail\nsleep 30\n",
    )
    (studio_root / "tools" / "robotick-hub").symlink_to(HUB_DIR, target_is_directory=True)
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


def test_top_level_ls_presents_contexts_separately_from_actions() -> None:
    text = format_shell_context(ShellState(), str(create_fake_workspace()))
    assert "Available here:" in text
    assert "Contexts:\n- hub/\n- studio/" in text
    assert "Actions:\n- ls\n- cd\n- clear\n- help\n- exit" in text


def test_studio_ls_exposes_instance_folders_as_contexts_and_open_as_action() -> None:
    workspace = create_fake_workspace()
    run_cli(["studio", "open"], workspace)
    text = format_shell_context(ShellState(namespace="studio"), str(workspace))
    assert "Available in studio:" in text
    assert "Contexts:\n- studio-" in text
    assert "Actions:\n- projects\n- instances\n- create [project]\n- open [project]" in text


def test_studio_help_is_generated_from_command_registry() -> None:
    open_spec = get_studio_command_spec("open")
    help_text = get_studio_help_text()
    assert f"  {open_spec.usage}" in help_text
    assert open_spec.summary in help_text


def test_hub_status_starts_hub_and_reports_capabilities() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["hub", "status"], workspace)
    assert result.returncode == 0
    assert "Robotick hub is ready." in result.stdout
    assert "Capabilities:" in result.stdout

    record = discover_hub(workspace)
    assert record is not None
    terminate_pid(record.pid)


def test_hub_projects_reads_workspace_projects_through_hub_json() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["hub", "projects", "--json"], workspace)
    assert result.returncode == 0
    assert '"name": "barr-e"' in result.stdout

    record = discover_hub(workspace)
    assert record is not None
    terminate_pid(record.pid)


def test_bound_instance_ls_advertises_quit_as_action() -> None:
    text = format_shell_context(
        ShellState(namespace="studio", instance_name="studio-12345"),
        str(create_fake_workspace()),
    )
    assert "Available in studio/studio-12345:" in text
    assert "Actions:\n- projects\n- ls\n- cd\n- clear\n- help\n- back\n- quit\n- exit" in text


def test_open_without_project_launches_empty_studio_quietly() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["studio", "open"], workspace)

    assert result.returncode == 0
    assert "Opening Robotick Studio..." in result.stdout
    assert "Studio launch started." in result.stdout
    assert "Instance: studio-" in result.stdout
    logs_dir = workspace / ".robotick" / "logs"
    assert any(name.name.startswith("studio-open-empty-") for name in logs_dir.iterdir())


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
    assert "Opening Robotick Studio for barr-e..." in result.stdout
    assert "Studio launch started for barr-e." in result.stdout
    assert "Instance: studio-" in result.stdout


def test_instances_list_live_instances_created_by_open() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = next(
        line.split(": ", 1)[1][:-1]
        for line in opened.stdout.splitlines()
        if line.startswith("Instance: ")
    )

    listed = run_cli(["studio", "instances"], workspace)
    assert listed.returncode == 0
    assert f"- {instance_name}" in listed.stdout


def test_one_shot_quit_closes_live_instance_cleanly() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = next(
        line.split(": ", 1)[1][:-1]
        for line in opened.stdout.splitlines()
        if line.startswith("Instance: ")
    )

    quit_result = run_cli(["studio", instance_name, "quit"], workspace)
    assert quit_result.returncode == 0
    assert (
        f"Studio instance {instance_name} closed." in quit_result.stdout
        or f"Studio instance {instance_name} force-closed after not exiting cleanly." in quit_result.stdout
    )
    wait_for(lambda: not (workspace / ".robotick" / "instances" / f"{instance_name}.json").exists())


def test_cd_enters_a_discovered_instance_context() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = next(
        line.split(": ", 1)[1][:-1]
        for line in opened.stdout.splitlines()
        if line.startswith("Instance: ")
    )
    state = ShellState(namespace="studio")
    apply_cd(AppContext(workspace_root=workspace), state, [instance_name])
    assert state == ShellState(namespace="studio", instance_name=instance_name)


def test_shell_open_composite_binds_new_instance_into_context() -> None:
    state = ShellState(namespace="studio")
    bind_opened_instance_to_state(state, CommandResult(exit_code=0, opened_instance_name="studio-12345"))
    assert state == ShellState(namespace="studio", instance_name="studio-12345")


def test_shell_create_primitive_does_not_bind_without_opened_instance() -> None:
    state = ShellState(namespace="studio")
    bind_opened_instance_to_state(state, CommandResult(exit_code=0))
    assert state == ShellState(namespace="studio")


def test_back_unwinds_from_instance_context_to_studio_without_leaving_cli() -> None:
    next_state = step_back(ShellState(namespace="studio", instance_name="studio-12345"))
    assert next_state == ShellState(namespace="studio")


def test_back_unwinds_from_studio_context_to_top_level() -> None:
    next_state = step_back(ShellState(namespace="studio"))
    assert next_state == ShellState()


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
