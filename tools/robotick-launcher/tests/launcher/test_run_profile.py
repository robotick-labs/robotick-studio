from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import yaml

from robotick.launcher.actions.launch import run_profile as run_profile_module
from robotick.launcher.actions.launch.target_plan import (
    LOCAL_STRATEGY,
    REMOTE_STRATEGY,
    TargetActionPlan,
    TargetPlan,
)
from robotick.launcher.utils import find_local_process_ids_for_binary


class _FakeProc:
    def __init__(self, returncode: int = 0):
        self.returncode = returncode
        self.pid = 12345
        self.stdout = None

    def wait(self, timeout=None):
        return self.returncode

    def poll(self):
        return self.returncode

    def send_signal(self, sig):
        return None


def test_run_profile_native_all_uses_per_model_targets(monkeypatch, tmp_path):
    project_dir = tmp_path / "robots" / "alf-e"
    project_dir.mkdir(parents=True)

    (project_dir / "alf-e.project.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "engine": {"local_path": "${PROJECT_DIR}/../../robotick/robotick-engine"},
                }
            }
        ),
        encoding="utf-8",
    )
    (project_dir / "alf-e-face.model.yaml").write_text(
        yaml.safe_dump({"runtime": {"target_platform": "linux", "target_variant": "arm64"}}),
        encoding="utf-8",
    )
    (project_dir / "alf-e-spine.model.yaml").write_text(
        yaml.safe_dump({"runtime": {"target_platform": "esp32", "target_variant": "esp32s3_m5"}}),
        encoding="utf-8",
    )

    for model_id, target in (("alf-e-face", "linux"), ("alf-e-spine", "esp32")):
        binary_path = run_profile_module.get_launcher_paths(
            "alf-e",
            model_id,
            target,
            project_dir,
        )[2]
        binary_path.parent.mkdir(parents=True, exist_ok=True)
        binary_path.write_text("fake-binary", encoding="utf-8")

    install_targets: list[str] = []
    launched_commands: list[list[str]] = []

    monkeypatch.setattr(
        run_profile_module.install_deps_stage,
        "install_deps",
        lambda project, base_dir, workspace_root, model, target: install_targets.append(target),
    )
    monkeypatch.setattr(run_profile_module, "stream_output", lambda proc, tag: None)
    monkeypatch.setattr(
        run_profile_module,
        "_wait_for_run_readiness",
        lambda launched_models, run_proc_map, model_health_urls, status_queue: launched_models,
    )

    def _fake_run_subprocess(command, **kwargs):
        launched_commands.append(command)
        if kwargs.get("wait", True):
            return _FakeProc(0)
        return _FakeProc(0)

    monkeypatch.setattr(run_profile_module, "run_subprocess", _fake_run_subprocess)

    result = run_profile_module.run_profile(
        "alf-e",
        "native:ALL",
        base_dir=project_dir,
    )

    assert result["status"] == "ok"
    assert install_targets == ["linux", "esp32"]

    build_targets = {
        (cmd[2], cmd[3]): cmd[4]
        for cmd in launched_commands
        if len(cmd) >= 5 and cmd[1] == "build"
    }
    run_targets = {
        (cmd[2], cmd[3]): cmd[4]
        for cmd in launched_commands
        if len(cmd) >= 5 and cmd[1] == "run"
    }
    deploy_commands = [
        cmd for cmd in launched_commands if len(cmd) >= 5 and cmd[1] == "deploy"
    ]

    assert build_targets[("alf-e", "alf-e-face")] == "linux"
    assert build_targets[("alf-e", "alf-e-spine")] == "esp32"
    assert deploy_commands == []
    assert run_targets[("alf-e", "alf-e-face")] == "linux"
    assert run_targets[("alf-e", "alf-e-spine")] == "esp32"


def test_run_profile_normalizes_model_yaml_path(monkeypatch, tmp_path):
    project_dir = tmp_path / "robots" / "alf-e"
    project_dir.mkdir(parents=True)

    (project_dir / "alf-e.project.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "engine": {"local_path": "${PROJECT_DIR}/../../robotick/robotick-engine"},
                }
            }
        ),
        encoding="utf-8",
    )
    (project_dir / "alf-e-face.model.yaml").write_text(
        yaml.safe_dump({"runtime": {"target_platform": "linux"}}),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        run_profile_module.install_deps_stage,
        "install_deps",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(run_profile_module, "stream_output", lambda proc, tag: None)
    monkeypatch.setattr(
        run_profile_module,
        "_wait_for_run_readiness",
        lambda launched_models, run_proc_map, model_health_urls, status_queue: launched_models,
    )
    monkeypatch.setattr(
        run_profile_module,
        "_wait_for_run_readiness",
        lambda launched_models, run_proc_map, model_health_urls, status_queue: launched_models,
    )

    commands: list[list[str]] = []

    def _fake_run_subprocess(command, **kwargs):
        commands.append(command)
        return _FakeProc(0)

    monkeypatch.setattr(run_profile_module, "run_subprocess", _fake_run_subprocess)

    result = run_profile_module.run_profile(
        "alf-e",
        "native:models/alf-e-face.model.yaml",
        base_dir=project_dir,
        run_after_build=False,
    )

    assert result["status"] == "build_completed"
    build_commands = [cmd for cmd in commands if len(cmd) >= 4 and cmd[1] == "build"]
    assert build_commands[0][3] == "alf-e-face"


def test_stop_profile_uses_target_specific_stop_handlers(monkeypatch, tmp_path):
    project_dir = tmp_path / "robots" / "alf-e"
    project_dir.mkdir(parents=True)

    (project_dir / "alf-e.project.yaml").write_text(yaml.safe_dump({}), encoding="utf-8")
    (project_dir / "alf-e-face.model.yaml").write_text(
        yaml.safe_dump({"runtime": {"target_platform": "linux"}}),
        encoding="utf-8",
    )
    (project_dir / "alf-e-rc.model.yaml").write_text(
        yaml.safe_dump({"runtime": {"target_platform": "linux"}}),
        encoding="utf-8",
    )

    stop_calls: list[tuple[str, bool]] = []
    local_stop_calls: list[tuple[Path, bool]] = []

    monkeypatch.setattr(
        run_profile_module,
        "get_launcher_paths",
        lambda project, model, target, base_dir: (
            base_dir / ".launcher" / model / target,
            base_dir / ".launcher" / model / target / "build",
            base_dir / ".launcher" / model / target / "build" / model,
        ),
    )
    monkeypatch.setattr(
        run_profile_module,
        "_resolve_profile_model_ids",
        lambda project_path, model_spec: ["alf-e-face", "alf-e-rc"],
    )
    monkeypatch.setattr(
        run_profile_module,
        "_resolve_profile_model_target",
        lambda project_name, base_dir, platform, model_id: "linux",
    )

    def _fake_resolve_target_plan(project, model, target, base_dir):
        if model == "alf-e-rc":
            return TargetPlan(
                project=project,
                model=model,
                target=target,
                target_platform="linux",
                target_variant="arm64",
                build=TargetActionPlan(strategy=LOCAL_STRATEGY),
                deploy=TargetActionPlan(strategy=REMOTE_STRATEGY),
                run=TargetActionPlan(
                    strategy=REMOTE_STRATEGY,
                    stop_handler=lambda dry_run, m=model: stop_calls.append((m, dry_run)),
                ),
            )
        return TargetPlan(
            project=project,
            model=model,
            target=target,
            target_platform="linux",
            target_variant="arm64",
            build=TargetActionPlan(strategy=LOCAL_STRATEGY),
            deploy=TargetActionPlan(strategy=LOCAL_STRATEGY),
            run=TargetActionPlan(strategy=LOCAL_STRATEGY),
        )

    monkeypatch.setattr(run_profile_module, "resolve_target_plan", _fake_resolve_target_plan)
    monkeypatch.setattr(
        run_profile_module,
        "stop_local_binary_process",
        lambda binary_path, dry_run: local_stop_calls.append((binary_path, dry_run)),
    )

    result = run_profile_module.stop_profile("alf-e", "native:ALL", base_dir=project_dir)

    assert result["status"] == "stopped"
    assert stop_calls == [("alf-e-rc", False)]
    assert len(local_stop_calls) == 1
    assert local_stop_calls[0][0].name == "alf-e-face"


def test_stop_profile_kills_local_helper_descendants(monkeypatch, tmp_path):
    project_dir = tmp_path / "robots" / "alf-e"
    project_dir.mkdir(parents=True)

    (project_dir / "alf-e.project.yaml").write_text(yaml.safe_dump({}), encoding="utf-8")
    (project_dir / "alf-e-brain.model.yaml").write_text(
        yaml.safe_dump({"runtime": {"target_platform": "linux"}}),
        encoding="utf-8",
    )

    helper_binary = tmp_path / "fake-barr-e-brain"
    shutil.copy2("/bin/sleep", helper_binary)
    helper_binary.chmod(0o755)

    monkeypatch.setattr(
        run_profile_module,
        "get_launcher_paths",
        lambda project, model, target, base_dir: (
            base_dir / ".launcher" / model / target,
            base_dir / ".launcher" / model / target / "build",
            helper_binary,
        ),
    )
    monkeypatch.setattr(
        run_profile_module,
        "_resolve_profile_model_ids",
        lambda project_path, model_spec: ["alf-e-brain"],
    )
    monkeypatch.setattr(
        run_profile_module,
        "_resolve_profile_model_target",
        lambda project_name, base_dir, platform, model_id: "linux",
    )
    monkeypatch.setattr(
        run_profile_module,
        "resolve_target_plan",
        lambda project, model, target, base_dir: TargetPlan(
            project=project,
            model=model,
            target=target,
            target_platform="linux",
            target_variant="arm64",
            build=TargetActionPlan(strategy=LOCAL_STRATEGY),
            deploy=TargetActionPlan(strategy=LOCAL_STRATEGY),
            run=TargetActionPlan(strategy=LOCAL_STRATEGY),
        ),
    )

    helper_proc = subprocess.Popen(
        [
            sys.executable,
            "-c",
            (
                "import subprocess, sys, time; "
                "subprocess.Popen([sys.argv[1], '60'], start_new_session=True); "
                "time.sleep(60)"
            ),
            str(helper_binary),
        ],
        start_new_session=True,
    )

    try:
        deadline = time.time() + 5.0
        child_pid = None
        while time.time() < deadline:
            children = run_profile_module._collect_descendant_pids(helper_proc.pid)
            if children:
                child_pid = children[0]
                break
            time.sleep(0.1)

        assert child_pid is not None
        assert Path(f"/proc/{helper_proc.pid}").exists()
        assert Path(f"/proc/{child_pid}").exists()

        result = run_profile_module.stop_profile(
            "alf-e",
            "native:ALL",
            base_dir=project_dir,
            helper_pids={"alf-e-brain": helper_proc.pid},
        )

        assert result["status"] == "stopped"

        deadline = time.time() + 6.0
        while time.time() < deadline:
            helper_alive = run_profile_module._pid_is_active(helper_proc.pid)
            child_alive = run_profile_module._pid_is_active(child_pid)
            binary_pids = find_local_process_ids_for_binary(helper_binary)
            if not helper_alive and not child_alive and not binary_pids:
                break
            time.sleep(0.1)

        assert not run_profile_module._pid_is_active(helper_proc.pid)
        assert not run_profile_module._pid_is_active(child_pid)
        assert find_local_process_ids_for_binary(helper_binary) == []
    finally:
        for pid in [*run_profile_module._collect_descendant_pids(helper_proc.pid), helper_proc.pid]:
            try:
                os.kill(pid, 9)
            except OSError:
                pass


def test_run_profile_dedupes_shared_remote_deploy(monkeypatch, tmp_path):
    project_dir = tmp_path / "robots" / "alf-e"
    project_dir.mkdir(parents=True)

    (project_dir / "alf-e.project.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "engine": {
                        "local_path": "${PROJECT_DIR}/../../robotick/robotick-engine",
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    (project_dir / "alf-e-face.model.yaml").write_text(
        yaml.safe_dump({"runtime": {"target_platform": "linux"}}),
        encoding="utf-8",
    )
    (project_dir / "alf-e-rc.model.yaml").write_text(
        yaml.safe_dump({"runtime": {"target_platform": "linux"}}),
        encoding="utf-8",
    )

    commands: list[list[str]] = []

    monkeypatch.setattr(
        run_profile_module.install_deps_stage,
        "install_deps",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(run_profile_module, "stream_output", lambda proc, tag: None)
    monkeypatch.setattr(
        run_profile_module,
        "_wait_for_run_readiness",
        lambda launched_models, run_proc_map, model_health_urls, status_queue: launched_models,
    )

    def _fake_run_subprocess(command, **kwargs):
        commands.append(command)
        return _FakeProc(0)

    monkeypatch.setattr(run_profile_module, "run_subprocess", _fake_run_subprocess)

    shared_key = ("remote-linux-project-sync", "paul@pi5", "$HOME/dev/robotick/robots/alf-e")

    def _fake_resolve_target_plan(project, model, target, base_dir):
        return TargetPlan(
            project=project,
            model=model,
            target=target,
            target_platform="linux",
            target_variant="arm64",
            build=TargetActionPlan(strategy=LOCAL_STRATEGY),
            deploy=TargetActionPlan(
                strategy=REMOTE_STRATEGY,
                shared_deploy_key=shared_key,
            ),
            run=TargetActionPlan(strategy=REMOTE_STRATEGY),
        )

    monkeypatch.setattr(run_profile_module, "resolve_target_plan", _fake_resolve_target_plan)

    result = run_profile_module.run_profile(
        "alf-e",
        "native:ALL",
        base_dir=project_dir,
    )

    assert result["status"] == "ok"

    deploy_commands = [cmd for cmd in commands if len(cmd) >= 5 and cmd[1] == "deploy"]
    run_commands = [cmd for cmd in commands if len(cmd) >= 5 and cmd[1] == "run"]

    assert len(deploy_commands) == 1
    assert len(run_commands) == 2
