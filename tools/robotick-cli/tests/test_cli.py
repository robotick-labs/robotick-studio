from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import json

import pytest

import robotick_cli.hub_client as hub_client_module
import robotick_cli.studio
from robotick_cli.app.context import AppContext, ShellState
from robotick_cli.hub_client import HubRecord, discover_hub, desktop_tray_expected, ensure_hub, get_hub_record_path
from robotick_cli.interfaces.completion import get_completion_matches
import robotick_cli.interfaces.repl as repl_module
from robotick_cli.instances import parse_instance_pid, reconcile_bound_instance
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
    instance_workbench_help_text,
)
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
    assert "Contexts:\n- hub/\n- launcher/\n- studio/" in text
    assert "Actions:\n- ls\n- cd\n- clear\n- help\n- exit" in text


def test_launcher_ls_exposes_launcher_actions() -> None:
    text = format_shell_context(ShellState(namespace="launcher"), str(create_fake_workspace()))
    assert "Available in launcher:" in text
    assert "Actions:\n- status\n- ls\n- cd\n- clear\n- help\n- back\n- exit" in text


def test_studio_ls_exposes_instance_folders_as_contexts_and_open_as_action() -> None:
    workspace = create_fake_workspace()
    run_cli(["studio", "open"], workspace)
    text = format_shell_context(ShellState(namespace="studio"), str(workspace))
    assert "Available in studio:" in text
    assert "Contexts:\n- studio-" in text
    assert "Actions:\n- projects\n- instances\n- create [project]\n- open [project]" in text


def test_studio_help_is_generated_from_command_registry() -> None:
    open_spec = get_studio_command_spec("open")
    workbench_spec = get_studio_command_spec("workbench")
    help_text = get_studio_help_text()
    assert f"  {open_spec.usage}" in help_text
    assert open_spec.summary in help_text
    assert f"  {workbench_spec.usage}" in help_text


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


def test_launcher_status_uses_hub_managed_launcher_path() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["launcher", "status", "--json"], workspace)
    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["capability_status"] == "healthy"
    assert payload["endpoint"].startswith("http://127.0.0.1:")
    assert payload["listener_status"]["status"] == "stopped"

    record = discover_hub(workspace)
    assert record is not None
    terminate_pid(record.pid)
    launcher_record_path = workspace / ".robotick" / "launcher.json"
    if launcher_record_path.exists():
        launcher_payload = json.loads(launcher_record_path.read_text(encoding="utf-8"))
        terminate_pid(launcher_payload.get("pid"))


def test_studio_projects_uses_same_hub_backed_project_truth() -> None:
    workspace = create_fake_workspace()
    hub_result = run_cli(["hub", "projects", "--json"], workspace)
    studio_result = run_cli(["studio", "projects", "--json"], workspace)
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
    assert "Robotick launcher is available through robotick-hub." in result.stdout

    record = discover_hub(workspace)
    assert record is not None
    terminate_pid(record.pid)
    launcher_record_path = workspace / ".robotick" / "launcher.json"
    if launcher_record_path.exists():
        launcher_payload = json.loads(launcher_record_path.read_text(encoding="utf-8"))
        terminate_pid(launcher_payload.get("pid"))


def test_bound_instance_ls_advertises_workbench_and_quit_as_actions() -> None:
    text = format_shell_context(
        ShellState(namespace="studio", instance_name="studio-12345"),
        str(create_fake_workspace()),
    )
    assert "Available in studio/studio-12345:" in text
    assert (
        "Actions:\n- projects\n- ls\n- cd\n- clear\n- help\n- back\n- quit\n- workbench\n- exit"
        in text
    )


def test_instance_help_lists_workbench_command() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = next(
        line.split(": ", 1)[1][:-1]
        for line in opened.stdout.splitlines()
        if line.startswith("Instance: ")
    )

    result = run_cli(["studio", instance_name], workspace)

    assert result.returncode == 0
    assert f"robotick studio {instance_name} workbench [--help]" in result.stdout
    assert "workbench Inspect Studio workbench commands" in result.stdout


def test_instance_workbench_help_is_available() -> None:
    help_text = instance_workbench_help_text("studio-12345")
    assert "robotick studio studio-12345 workbench [--help]" in help_text
    assert "Inspect or act on Studio workbench state for the targeted instance." in help_text


def test_instance_workbench_subcommands_fail_clearly_until_implemented() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = next(
        line.split(": ", 1)[1][:-1]
        for line in opened.stdout.splitlines()
        if line.startswith("Instance: ")
    )

    result = run_cli(["studio", instance_name, "workbench", "status"], workspace)

    assert result.returncode == 1
    assert (
        "Studio workbench subcommands are not implemented yet. "
        "Use 'robotick studio <instance> workbench --help' for the current grammar."
        in result.stderr
    )


def test_open_without_project_launches_empty_studio_quietly() -> None:
    workspace = create_fake_workspace()
    result = run_cli(["studio", "open"], workspace)

    assert result.returncode == 0
    assert "Opening Robotick Studio..." in result.stdout
    assert "Studio launch started." in result.stdout
    assert "Instance: studio-" in result.stdout
    logs_dir = workspace / ".robotick" / "logs"
    assert any(name.name.startswith("studio-open-empty-") for name in logs_dir.iterdir())


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
            }
        }

    monkeypatch.setattr("robotick_cli.studio.post_hub_json", fake_post)
    monkeypatch.setattr("robotick_cli.studio.restart_hub", lambda _workspace: state.__setitem__("restarted", state["restarted"] + 1) or fresh_record)

    result = robotick_cli.studio.run_studio_command(AppContext(workspace_root=workspace), ["open"])
    assert result.exit_code == 0
    assert result.opened_instance_name == "studio-2222"
    assert state["restarted"] == 1


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


def test_direct_instance_entry_works_without_cd() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = next(
        line.split(": ", 1)[1][:-1]
        for line in opened.stdout.splitlines()
        if line.startswith("Instance: ")
    )
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
    first_instance = next(
        line.split(": ", 1)[1][:-1]
        for line in first_opened.stdout.splitlines()
        if line.startswith("Instance: ")
    )
    second_instance = next(
        line.split(": ", 1)[1][:-1]
        for line in second_opened.stdout.splitlines()
        if line.startswith("Instance: ")
    )
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
    instance_name = next(
        line.split(": ", 1)[1][:-1]
        for line in opened.stdout.splitlines()
        if line.startswith("Instance: ")
    )

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
    instance_name = next(
        line.split(": ", 1)[1][:-1]
        for line in opened.stdout.splitlines()
        if line.startswith("Instance: ")
    )

    matches = get_completion_matches(
        AppContext(workspace_root=workspace),
        ShellState(namespace="studio"),
        f"{instance_name} q",
        len(instance_name) + 1,
        len(instance_name) + 2,
    )

    assert "quit" in matches


def test_completion_suggests_instance_workbench_in_studio_context() -> None:
    workspace = create_fake_workspace()
    opened = run_cli(["studio", "open"], workspace)
    instance_name = next(
        line.split(": ", 1)[1][:-1]
        for line in opened.stdout.splitlines()
        if line.startswith("Instance: ")
    )

    matches = get_completion_matches(
        AppContext(workspace_root=workspace),
        ShellState(namespace="studio"),
        f"{instance_name} w",
        len(instance_name) + 1,
        len(instance_name) + 2,
    )

    assert "workbench" in matches


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
            return {"status": "ok", "tray_active": False}
        return {"status": "ok", "tray_active": True}

    monkeypatch.setattr(hub_client_module, "discover_hub", fake_discover)
    monkeypatch.setattr(hub_client_module, "is_pid_alive", fake_is_pid_alive)
    monkeypatch.setattr(hub_client_module, "fetch_hub_json", fake_fetch)
    monkeypatch.setattr(hub_client_module, "start_hub", lambda _workspace: state.__setitem__("started", state["started"] + 1))
    monkeypatch.setattr(hub_client_module, "stop_hub_process", lambda pid: state["stopped"].append(pid))

    record = ensure_hub(workspace)
    assert record.pid == 222
    assert state["stopped"] == [111]
    assert state["started"] == 1


def test_select_hub_python_executable_requires_pyqt5_in_managed_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.delenv("ROBOTICK_HUB_FORCE_HEADLESS", raising=False)
    monkeypatch.setattr(hub_client_module, "python_supports_module", lambda executable, module: executable == sys.executable and module == "PyQt5")
    assert hub_client_module.select_hub_python_executable() == sys.executable
