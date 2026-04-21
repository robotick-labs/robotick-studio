from __future__ import annotations

from pathlib import Path

import yaml

from robotick.launcher.actions.launch.docker_linux import (
    DockerLinuxSpec,
    build_docker_linux,
    deploy_docker_linux,
    ensure_running_docker_linux_container,
    ensure_docker_image as ensure_docker_linux_image,
    load_docker_linux_spec,
    run_docker_linux,
    stop_docker_linux,
)
from robotick.launcher.actions.launch import docker_linux as docker_linux_module
from robotick.launcher.actions.launch.target_plan import (
    CONTAINER_STRATEGY,
    LOCAL_STRATEGY,
    REMOTE_STRATEGY,
    TargetActionPlan,
    TargetPlan,
    resolve_target_plan,
)
from robotick.launcher.actions.launch import target_plan as target_plan_module
from robotick.launcher.actions.launch import remote_linux
from robotick.launcher.actions.launch.remote_linux import (
    RemoteLinuxSpec,
    load_remote_linux_spec,
)
from robotick.launcher.actions.launch import run as run_module


DockerLinuxArm64Spec = DockerLinuxSpec
DockerLinuxArm32Spec = DockerLinuxSpec
DockerLinuxX64Spec = DockerLinuxSpec
build_docker_linux_arm64 = build_docker_linux
build_docker_linux_arm32 = build_docker_linux
build_docker_linux_x64 = build_docker_linux
deploy_docker_linux_x64 = deploy_docker_linux
ensure_running_docker_linux_x64_container = ensure_running_docker_linux_container
ensure_docker_linux_arm64_image = ensure_docker_linux_image
ensure_docker_linux_arm32_image = ensure_docker_linux_image
ensure_docker_linux_x64_image = ensure_docker_linux_image
load_docker_linux_arm64_spec = load_docker_linux_spec
load_docker_linux_arm32_spec = load_docker_linux_spec
load_docker_linux_x64_spec = load_docker_linux_spec
run_docker_linux_x64 = run_docker_linux
stop_docker_linux_x64 = stop_docker_linux


def _docker_linux_spec(
    *,
    family: str,
    image_name: str,
    dockerfile: str,
    container_name: str,
    launcher_dir: str,
    binary_path: str,
    workspace_root: str = "/tmp/repo",
    working_dir: str = "/tmp/repo/robots/proj",
    supports_runtime: bool = False,
    use_host_network: bool | None = None,
) -> DockerLinuxSpec:
    if use_host_network is None:
        use_host_network = family == "linux-x64"
    return DockerLinuxSpec(
        family=family,
        image_name=image_name,
        dockerfile=Path(dockerfile),
        container_name=container_name,
        local_repo_root=Path(workspace_root),
        local_launcher_dir=Path(launcher_dir),
        local_binary_path=Path(binary_path),
        container_workspace_root=workspace_root,
        container_launcher_dir=launcher_dir,
        container_working_dir=working_dir,
        container_binary_path=binary_path,
        supports_runtime=supports_runtime,
        use_host_network=use_host_network,
    )


def test_load_remote_linux_spec_resolves_remote_paths_and_root_paths(tmp_path):
    repo_root = tmp_path / "repo"
    project_dir = repo_root / "robots" / "alf-e"
    project_dir.mkdir(parents=True)

    (repo_root / "robotick" / "robotick-engine").mkdir(parents=True)
    (repo_root / "robotick" / "robotick-core-workloads" / "cpp" / "include").mkdir(
        parents=True
    )
    (repo_root / "robotick" / "robotick-core-workloads" / "cpp" / "src").mkdir(
        parents=True
    )
    (repo_root / "robots" / "barr-e" / "cpp" / "src").mkdir(parents=True)

    project_yaml = {
        "runtime": {
            "engine": {
                "local_path": "${PROJECT_DIR}/../../robotick/robotick-engine",
            },
            "workload_sources": [
                {
                    "id": "barr-e-workloads",
                    "local_path": "${PROJECT_DIR}/../barr-e",
                    "root_paths": ["cpp/include", "cpp/src"],
                },
                {
                    "id": "robotick-core-workloads",
                    "local_path": "${PROJECT_DIR}/../../robotick/robotick-core-workloads",
                    "root_paths": ["cpp/include", "cpp/src"],
                },
            ],
        }
    }
    (project_dir / "alf-e.project.yaml").write_text(yaml.safe_dump(project_yaml))
    (project_dir / "alf-e-face.model.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "target_platform": "linux",
                    "target_variant": "arm64",
                    "preferred_host": "raspberrypi.local",
                    "deploy": {
                        "remote_project_path": "~/dev/robotick/robotick-knitware",
                    },
                }
            }
        )
    )

    spec = load_remote_linux_spec("alf-e", "alf-e-face", "linux", project_dir)

    assert spec is not None
    assert spec.host == "raspberrypi.local"
    assert spec.remote_repo_root == "$HOME/dev/robotick/robotick-knitware"
    assert spec.remote_project_dir.endswith("/robots/alf-e")
    sync_remotes = {sync.remote_path for sync in spec.sync_paths}
    assert "$HOME/dev/robotick/robotick-knitware/robots/barr-e/cpp/src" in sync_remotes
    assert "$HOME/dev/robotick/robotick-knitware/robots/barr-e" not in sync_remotes
    assert (
        "$HOME/dev/robotick/robotick-knitware/robots/barr-e/cpp/include"
        not in sync_remotes
    )


def test_run_dry_run_uses_remote_linux_path(monkeypatch, tmp_path):
    base_dir = tmp_path / "proj"
    base_dir.mkdir()
    (base_dir / "proj.project.yaml").write_text(
        yaml.safe_dump({"runtime": {"engine": {"local_path": "engine"}}})
    )

    calls: list[tuple[str, bool]] = []

    monkeypatch.setattr(
        run_module,
        "resolve_target_plan",
        lambda *args, **kwargs: TargetPlan(
            project="proj",
            model="proj-face",
            target="linux",
            target_platform="linux",
            target_variant="arm64",
            build=TargetActionPlan(strategy=REMOTE_STRATEGY),
            deploy=TargetActionPlan(strategy=REMOTE_STRATEGY),
            run=TargetActionPlan(
                strategy=REMOTE_STRATEGY,
                stop_handler=lambda dry_run: calls.append(("stop", dry_run)),
                run_handler=lambda dry_run: calls.append(("run", dry_run)),
            ),
        ),
    )

    run_module.run("proj", "proj-face", "linux", base_dir=base_dir, dry_run=True)

    assert calls == [("stop", True), ("run", True)]


def test_run_remote_linux_wraps_child_process_and_exports_library_path(monkeypatch):
    spec = RemoteLinuxSpec(
        host="raspberrypi.local",
        ssh_target="raspberrypi.local",
        target_variant="arm64",
        local_project_dir=Path("/tmp/local-project"),
        remote_repo_root="$HOME/dev/robotick/robotick-knitware",
        remote_project_dir="$HOME/dev/robotick/robotick-knitware/robots/alf-e",
        remote_working_dir="$HOME/dev/robotick/robotick-knitware/robots/alf-e",
        remote_launcher_dir="$HOME/dev/robotick/robotick-knitware/robots/alf-e/.launcher/alf_e/generated/alf_e_face/linux",
        remote_binary_path="$HOME/dev/robotick/robotick-knitware/robots/alf-e/.launcher/alf_e/generated/alf_e_face/linux/build/alf-e-face",
        sync_paths=(),
    )

    calls: list[tuple[list[str], object]] = []
    monkeypatch.setattr(
        remote_linux,
        "run_subprocess",
        lambda cmd, on_interrupt=None: calls.append((cmd, on_interrupt)),
    )

    remote_linux.run_remote_linux(spec, dry_run=False)

    assert len(calls) == 1
    ssh_cmd, on_interrupt = calls[0]
    assert ssh_cmd[:2] == ["ssh", "raspberrypi.local"]
    assert "LD_LIBRARY_PATH=" in ssh_cmd[2]
    assert "/generated/alf_e_face/linux/build/robotick_engine/cpp:" in ssh_cmd[2]
    assert "/generated/alf_e_face/linux/build:$LD_LIBRARY_PATH" in ssh_cmd[2]
    assert "trap cleanup INT TERM HUP EXIT" in ssh_cmd[2]
    assert "child_pid=$!" in ssh_cmd[2]
    assert 'kill -TERM "$child_pid"' in ssh_cmd[2]
    assert callable(on_interrupt)


def test_load_docker_linux_spec_uses_model_scoped_container_name(tmp_path):
    repo_root = tmp_path / "repo"
    project_dir = repo_root / "robots" / "pip-e"
    project_dir.mkdir(parents=True)

    (repo_root / "robotick" / "robotick-engine").mkdir(parents=True)

    project_yaml = {
        "runtime": {
            "engine": {
                "local_path": "${PROJECT_DIR}/../../robotick/robotick-engine",
            },
        }
    }
    (project_dir / "pip-e.project.yaml").write_text(yaml.safe_dump(project_yaml))
    (project_dir / "pip-e-brain.model.yaml").write_text(yaml.safe_dump({"runtime": {}}))
    (project_dir / "pip-e-face.model.yaml").write_text(yaml.safe_dump({"runtime": {}}))

    brain_spec = load_docker_linux_spec("pip-e", "pip-e-brain", "linux", project_dir)
    face_spec = load_docker_linux_spec("pip-e", "pip-e-face", "linux", project_dir)

    assert brain_spec is not None
    assert face_spec is not None
    assert brain_spec.container_name != face_spec.container_name


def test_stop_docker_linux_matches_exact_binary_exe_path(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/Dockerfile",
        container_name="robotick-launcher-linux-x64-build-123",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
        use_host_network=False,
    )

    recorded: list[list[str]] = []
    monkeypatch.setattr(
        docker_linux_module,
        "ensure_running_docker_linux_container",
        lambda spec, dry_run: None,
    )
    monkeypatch.setattr(
        docker_linux_module,
        "_run_docker_exec",
        lambda command, dry_run: recorded.append(command),
    )

    stop_docker_linux(spec, dry_run=False)

    assert len(recorded) == 1
    shell_command = recorded[0][-1]
    assert 'readlink -f "$proc_dir/exe"' in shell_command
    assert 'kill -TERM "${matching_pids[@]}"' in shell_command
    assert "pkill -f" not in shell_command


def test_ensure_docker_linux_image_reuses_local_latest_by_default(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/Dockerfile",
        container_name="robotick-launcher-linux-x64-build-123",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
    )

    commands: list[list[str]] = []
    monkeypatch.setattr(docker_linux_module, "_docker_image_exists", lambda _image: True)
    monkeypatch.setattr(
        docker_linux_module,
        "run_subprocess",
        lambda command: commands.append(command),
    )

    ensure_docker_linux_image(spec, dry_run=False)

    assert commands == []


def test_ensure_docker_linux_x64_image_refreshes_latest_when_requested(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/robotick-ubuntu24.04-native-linux.Dockerfile",
        container_name="robotick-launcher-linux-x64-build-test",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
    )
    pull_calls: list[list[str]] = []

    monkeypatch.setenv("ROBOTICK_LAUNCHER_REFRESH_DOCKER_LATEST", "1")
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.run_subprocess",
        lambda cmd: pull_calls.append(cmd),
    )

    ensure_docker_linux_x64_image(spec, dry_run=False)

    assert pull_calls == [["docker", "pull", spec.image_name]]


def test_stop_remote_linux_process_kills_existing_binary(monkeypatch):
    spec = RemoteLinuxSpec(
        host="raspberrypi.local",
        ssh_target="raspberrypi.local",
        target_variant="arm64",
        local_project_dir=Path("/tmp/local-project"),
        remote_repo_root="$HOME/dev/robotick/robotick-knitware",
        remote_project_dir="$HOME/dev/robotick/robotick-knitware/robots/alf-e",
        remote_working_dir="$HOME/dev/robotick/robotick-knitware/robots/alf-e",
        remote_launcher_dir="$HOME/dev/robotick/robotick-knitware/robots/alf-e/.launcher/alf_e/generated/alf_e_face/linux",
        remote_binary_path="$HOME/dev/robotick/robotick-knitware/robots/alf-e/.launcher/alf_e/generated/alf_e_face/linux/build/alf-e-face",
        sync_paths=(),
    )

    commands: list[list[str]] = []
    monkeypatch.setattr(
        remote_linux, "run_subprocess", lambda cmd: commands.append(cmd)
    )

    remote_linux.stop_remote_linux_process(spec, dry_run=False)

    assert len(commands) == 1
    ssh_cmd = commands[0]
    assert ssh_cmd[:2] == ["ssh", "raspberrypi.local"]
    assert "pkill -TERM -f" in ssh_cmd[2]
    assert "pkill -KILL -f" in ssh_cmd[2]
    assert "alf-e-face" in ssh_cmd[2]


def test_stop_existing_local_process_uses_binary_path(monkeypatch):
    binary_path = Path(
        "/tmp/robots/alf-e/.launcher/alf_e/generated/alf_e_face/linux/build/alf-e-face"
    )
    stop_calls: list[tuple[Path, bool]] = []

    monkeypatch.setattr(
        run_module,
        "stop_local_binary_process",
        lambda path, dry_run: stop_calls.append((path, dry_run)),
    )

    run_module._stop_existing_local_process(binary_path, dry_run=False)

    assert stop_calls == [(binary_path, False)]


def test_find_local_process_ids_for_binary_matches_exact_exe_path(tmp_path):
    proc_root = tmp_path / "proc"
    proc_root.mkdir()
    binary_path = (tmp_path / "bin" / "target-model").resolve()
    binary_path.parent.mkdir()
    binary_path.write_text("")

    matching_proc = proc_root / "101"
    matching_proc.mkdir()
    (matching_proc / "exe").symlink_to(binary_path)

    different_binary = (tmp_path / "bin" / "other-model").resolve()
    different_binary.write_text("")
    other_proc = proc_root / "202"
    other_proc.mkdir()
    (other_proc / "exe").symlink_to(different_binary)

    nonsensical = proc_root / "not-a-pid"
    nonsensical.mkdir()

    assert run_module._find_local_process_ids_for_binary(
        binary_path, proc_root=proc_root
    ) == [101]


def test_run_dry_run_local_path_does_not_launch_binary(monkeypatch, tmp_path):
    base_dir = tmp_path / "proj"
    base_dir.mkdir()
    (base_dir / "proj.project.yaml").write_text(yaml.safe_dump({}))

    launcher_dir = base_dir / ".launcher" / "proj" / "generated" / "proj_face" / "linux"
    build_dir = launcher_dir / "build"
    build_dir.mkdir(parents=True)
    binary_path = build_dir / "proj-face"
    binary_path.write_text("")

    stop_calls: list[tuple[Path, bool]] = []
    run_subprocess_calls: list[list[str]] = []

    monkeypatch.setattr(
        run_module,
        "resolve_target_plan",
        lambda *args, **kwargs: TargetPlan(
            project="proj",
            model="proj-face",
            target="linux",
            target_platform="linux",
            target_variant="x86_64",
            build=TargetActionPlan(strategy=LOCAL_STRATEGY),
            deploy=TargetActionPlan(strategy=LOCAL_STRATEGY),
            run=TargetActionPlan(strategy=LOCAL_STRATEGY),
        ),
    )
    monkeypatch.setattr(
        run_module,
        "get_launcher_paths",
        lambda *args, **kwargs: (launcher_dir, build_dir, binary_path),
    )
    monkeypatch.setattr(
        run_module,
        "_stop_existing_local_process",
        lambda path, dry_run: stop_calls.append((path, dry_run)),
    )
    monkeypatch.setattr(
        run_module,
        "run_subprocess",
        lambda *args, **kwargs: run_subprocess_calls.append(args[0]),
    )

    run_module.run("proj", "proj-face", "linux", base_dir=base_dir, dry_run=True)

    assert stop_calls == [(binary_path, True)]
    assert run_subprocess_calls == []


def test_load_docker_linux_arm64_spec_points_at_shared_engine_dockerfile(tmp_path):
    repo_root = tmp_path / "repo"
    project_dir = repo_root / "robots" / "alf-e"
    project_dir.mkdir(parents=True)
    (repo_root / "robotick" / "robotick-engine").mkdir(parents=True)

    project_yaml = {
        "runtime": {
            "engine": {
                "local_path": "${PROJECT_DIR}/../../robotick/robotick-engine",
            },
        }
    }
    (project_dir / "alf-e.project.yaml").write_text(yaml.safe_dump(project_yaml))
    (project_dir / "alf-e-face.model.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "target_platform": "linux",
                    "target_variant": "arm64",
                    "preferred_host": "raspberrypi.local",
                }
            }
        )
    )

    spec = load_docker_linux_arm64_spec("alf-e", "alf-e-face", "linux", project_dir)

    assert spec is not None
    assert spec.dockerfile.name == "robotick-debian12-cross-linux-arm64.Dockerfile"
    assert spec.dockerfile == (
        repo_root
        / "robotick"
        / "robotick-engine"
        / "tools"
        / "docker"
        / "robotick-debian12-cross-linux-arm64.Dockerfile"
    )
    assert spec.container_name.startswith("robotick-launcher-linux-arm64-build-")
    assert spec.container_launcher_dir.endswith(
        "/robots/alf-e/.launcher/alf_e/generated/alf_e_face/linux"
    )


def test_build_docker_linux_arm64_execs_inside_keepalive_container(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-arm64",
        image_name="ghcr.io/robotick-labs/robotick-debian12-cross-linux-arm64:latest",
        dockerfile="/tmp/robotick-debian12-cross-linux-arm64.Dockerfile",
        container_name="robotick-launcher-linux-arm64-build-test",
        launcher_dir="/tmp/repo/.launcher/alf_e/generated/alf_e_face/linux",
        binary_path="/tmp/repo/.launcher/alf_e/generated/alf_e_face/linux/build/alf-e-face",
    )
    ensure_calls: list[tuple[DockerLinuxArm64Spec, bool]] = []
    run_calls: list[list[str]] = []

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.ensure_running_docker_linux_container",
        lambda actual_spec, dry_run: ensure_calls.append((actual_spec, dry_run)),
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.os.getuid",
        lambda: 1234,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.os.getgid",
        lambda: 5678,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.run_subprocess",
        lambda cmd: run_calls.append(cmd),
    )

    build_docker_linux_arm64(spec, dry_run=False)

    assert ensure_calls == [(spec, False)]
    assert run_calls == [
        [
            "docker",
            "exec",
            "--user",
            "1234:5678",
            "-e",
            "HOME=/tmp/robotick-home",
            "-w",
            "/tmp/repo",
            "robotick-launcher-linux-arm64-build-test",
            "bash",
            "-lc",
            "if [[ -d /opt/robotick/project-target-cache/deps ]]; then rm -rf /tmp/repo/.launcher/alf_e/generated/alf_e_face/linux/deps && mkdir -p /tmp/repo/.launcher/alf_e/generated/alf_e_face/linux/deps && cp -a /opt/robotick/project-target-cache/deps/. /tmp/repo/.launcher/alf_e/generated/alf_e_face/linux/deps/; fi",
        ],
        [
            "docker",
            "exec",
            "--user",
            "1234:5678",
            "-e",
            "HOME=/tmp/robotick-home",
            "-w",
            "/tmp/repo/.launcher/alf_e/generated/alf_e_face/linux",
            "robotick-launcher-linux-arm64-build-test",
            "bash",
            "-lc",
            "bash ./do_launcher_build.sh",
        ],
    ]


def test_docker_exec_command_falls_back_when_platform_has_no_getuid(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/robotick-ubuntu24.04-native-linux.Dockerfile",
        container_name="robotick-launcher-linux-x64-build-test",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
    )

    monkeypatch.delattr(docker_linux_module.os, "getuid", raising=False)
    monkeypatch.delattr(docker_linux_module.os, "getgid", raising=False)
    monkeypatch.setenv("ROBOTICK_DOCKER_UID", "2001")
    monkeypatch.setenv("ROBOTICK_DOCKER_GID", "2002")

    command = docker_linux_module._docker_exec_command(
        spec,
        "/tmp/repo",
        "bash ./do_launcher_build.sh",
    )

    assert command[:10] == [
        "docker",
        "exec",
        "--user",
        "2001:2002",
        "-e",
        "HOME=/tmp/robotick-home",
        "-w",
        "/tmp/repo",
        "robotick-launcher-linux-x64-build-test",
        "bash",
    ]
    assert command[10:] == ["-lc", "bash ./do_launcher_build.sh"]


def test_ensure_docker_linux_arm64_image_reuses_local_latest_by_default(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-arm64",
        image_name="ghcr.io/robotick-labs/robotick-debian12-cross-linux-arm64:latest",
        dockerfile="/tmp/robotick-debian12-cross-linux-arm64.Dockerfile",
        container_name="robotick-launcher-linux-arm64-build-test",
        launcher_dir="/tmp/repo/.launcher/alf_e/generated/alf_e_face/linux",
        binary_path="/tmp/repo/.launcher/alf_e/generated/alf_e_face/linux/build/alf-e-face",
    )
    pull_calls: list[list[str]] = []

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.run_subprocess",
        lambda cmd: pull_calls.append(cmd),
    )
    monkeypatch.setattr(docker_linux_module, "_docker_image_exists", lambda _image: True)

    ensure_docker_linux_arm64_image(spec, dry_run=False)

    assert pull_calls == []


def test_load_docker_linux_arm32_spec_points_at_shared_engine_dockerfile(tmp_path):
    repo_root = tmp_path / "repo"
    project_dir = repo_root / "robots" / "alf-e"
    project_dir.mkdir(parents=True)
    (repo_root / "robotick" / "robotick-engine").mkdir(parents=True)

    project_yaml = {
        "runtime": {
            "engine": {
                "local_path": "${PROJECT_DIR}/../../robotick/robotick-engine",
            },
        }
    }
    (project_dir / "alf-e.project.yaml").write_text(yaml.safe_dump(project_yaml))
    (project_dir / "alf-e-face.model.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "target_platform": "linux",
                    "target_variant": "arm32",
                    "preferred_host": "pi2.local",
                }
            }
        )
    )

    spec = load_docker_linux_arm32_spec("alf-e", "alf-e-face", "linux", project_dir)

    assert spec is not None
    assert spec.dockerfile == (
        repo_root
        / "robotick"
        / "robotick-engine"
        / "tools"
        / "docker"
        / "robotick-debian12-cross-linux-arm32.Dockerfile"
    )
    assert spec.container_name.startswith("robotick-launcher-linux-arm32-build-")


def test_build_docker_linux_arm32_execs_inside_keepalive_container(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-arm32",
        image_name="ghcr.io/robotick-labs/robotick-debian12-cross-linux-arm32:latest",
        dockerfile="/tmp/robotick-debian12-cross-linux-arm32.Dockerfile",
        container_name="robotick-launcher-linux-arm32-build-test",
        launcher_dir="/tmp/repo/.launcher/alf_e/generated/alf_e_face/linux",
        binary_path="/tmp/repo/.launcher/alf_e/generated/alf_e_face/linux/build/alf-e-face",
    )
    ensure_calls: list[tuple[DockerLinuxArm32Spec, bool]] = []
    run_calls: list[list[str]] = []

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.ensure_running_docker_linux_container",
        lambda actual_spec, dry_run: ensure_calls.append((actual_spec, dry_run)),
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.os.getuid",
        lambda: 1234,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.os.getgid",
        lambda: 5678,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.run_subprocess",
        lambda cmd: run_calls.append(cmd),
    )

    build_docker_linux_arm32(spec, dry_run=False)

    assert ensure_calls == [(spec, False)]
    assert run_calls == [
        [
            "docker",
            "exec",
            "--user",
            "1234:5678",
            "-e",
            "HOME=/tmp/robotick-home",
            "-w",
            "/tmp/repo",
            "robotick-launcher-linux-arm32-build-test",
            "bash",
            "-lc",
            "if [[ -d /opt/robotick/project-target-cache/deps ]]; then rm -rf /tmp/repo/.launcher/alf_e/generated/alf_e_face/linux/deps && mkdir -p /tmp/repo/.launcher/alf_e/generated/alf_e_face/linux/deps && cp -a /opt/robotick/project-target-cache/deps/. /tmp/repo/.launcher/alf_e/generated/alf_e_face/linux/deps/; fi",
        ],
        [
            "docker",
            "exec",
            "--user",
            "1234:5678",
            "-e",
            "HOME=/tmp/robotick-home",
            "-w",
            "/tmp/repo/.launcher/alf_e/generated/alf_e_face/linux",
            "robotick-launcher-linux-arm32-build-test",
            "bash",
            "-lc",
            "bash ./do_launcher_build.sh",
        ],
    ]


def test_ensure_docker_linux_arm32_image_reuses_local_latest_by_default(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-arm32",
        image_name="ghcr.io/robotick-labs/robotick-debian12-cross-linux-arm32:latest",
        dockerfile="/tmp/robotick-debian12-cross-linux-arm32.Dockerfile",
        container_name="robotick-launcher-linux-arm32-build-test",
        launcher_dir="/tmp/repo/.launcher/alf_e/generated/alf_e_face/linux",
        binary_path="/tmp/repo/.launcher/alf_e/generated/alf_e_face/linux/build/alf-e-face",
    )
    pull_calls: list[list[str]] = []

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.run_subprocess",
        lambda cmd: pull_calls.append(cmd),
    )
    monkeypatch.setattr(docker_linux_module, "_docker_image_exists", lambda _image: True)

    ensure_docker_linux_arm32_image(spec, dry_run=False)

    assert pull_calls == []


def test_resolve_target_plan_prefers_docker_build_and_remote_run_for_pi5_models(
    tmp_path,
):
    repo_root = tmp_path / "repo"
    project_dir = repo_root / "robots" / "alf-e"
    project_dir.mkdir(parents=True)
    (repo_root / "robotick" / "robotick-engine").mkdir(parents=True)

    (project_dir / "alf-e.project.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "engine": {
                        "local_path": "${PROJECT_DIR}/../../robotick/robotick-engine"
                    }
                }
            }
        )
    )
    (project_dir / "alf-e-face.model.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "target_platform": "linux",
                    "target_variant": "arm64",
                    "preferred_host": "raspberrypi.local",
                }
            }
        )
    )

    plan = resolve_target_plan("alf-e", "alf-e-face", "linux", project_dir)

    assert plan.build.strategy == CONTAINER_STRATEGY
    assert plan.deploy.strategy == REMOTE_STRATEGY
    assert plan.run.strategy == REMOTE_STRATEGY


def test_resolve_target_plan_prefers_docker_build_and_remote_run_for_pi2_models(
    tmp_path,
):
    repo_root = tmp_path / "repo"
    project_dir = repo_root / "robots" / "alf-e"
    project_dir.mkdir(parents=True)
    (repo_root / "robotick" / "robotick-engine").mkdir(parents=True)

    (project_dir / "alf-e.project.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "engine": {
                        "local_path": "${PROJECT_DIR}/../../robotick/robotick-engine"
                    }
                }
            }
        )
    )
    (project_dir / "alf-e-face.model.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "target_platform": "linux",
                    "target_variant": "arm32",
                    "preferred_host": "pi2.local",
                }
            }
        )
    )

    plan = resolve_target_plan("alf-e", "alf-e-face", "linux", project_dir)

    assert plan.build.strategy == CONTAINER_STRATEGY
    assert plan.deploy.strategy == REMOTE_STRATEGY
    assert plan.run.strategy == REMOTE_STRATEGY


def test_load_docker_linux_x64_spec_points_at_shared_engine_dockerfile(tmp_path):
    repo_root = tmp_path / "repo"
    project_dir = repo_root / "robots" / "proj"
    project_dir.mkdir(parents=True)
    (repo_root / "robotick" / "robotick-engine").mkdir(parents=True)

    (project_dir / "proj.project.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "engine": {
                        "local_path": "${PROJECT_DIR}/../../robotick/robotick-engine"
                    }
                }
            }
        )
    )
    (project_dir / "proj-face.model.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "target_platform": "linux",
                    "target_variant": "x86_64",
                    "preferred_host": "localhost",
                }
            }
        )
    )

    spec = load_docker_linux_x64_spec("proj", "proj-face", "linux", project_dir)

    assert spec is not None
    assert spec.dockerfile == (
        repo_root
        / "robotick"
        / "robotick-engine"
        / "tools"
        / "docker"
        / "robotick-ubuntu24.04-native-linux.Dockerfile"
    )
    assert spec.container_name.startswith("robotick-launcher-linux-x64-build-")
    assert spec.container_working_dir.endswith("/robots/proj")


def test_load_docker_linux_x64_spec_uses_prepared_project_image_when_present(tmp_path):
    repo_root = tmp_path / "repo"
    project_dir = repo_root / "robots" / "proj"
    project_dir.mkdir(parents=True)
    (repo_root / "robotick" / "robotick-engine").mkdir(parents=True)

    (project_dir / "proj.project.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "engine": {
                        "local_path": "${PROJECT_DIR}/../../robotick/robotick-engine"
                    },
                }
            }
        )
    )
    (project_dir / "proj-face.model.yaml").write_text(
        yaml.safe_dump(
            {"runtime": {"target_platform": "linux", "target_variant": "x86_64"}}
        )
    )

    metadata_dir = (
        project_dir / ".launcher" / "proj" / "project_docker" / "linux" / "linux-x64"
    )
    metadata_dir.mkdir(parents=True, exist_ok=True)
    (metadata_dir / "resolved-image.json").write_text(
        '{"image_name":"robotick-proj-linux-docker:linux-x64-deadbeef","image_repo":"robotick-proj-linux-docker","image_tag":"linux-x64-deadbeef","dockerfile_path":"'
        + str(metadata_dir / "Dockerfile")
        + '","context_dir":"'
        + str(metadata_dir)
        + '","scoped_models":["proj-face"]}\n',
        encoding="utf-8",
    )

    spec = load_docker_linux_x64_spec("proj", "proj-face", "linux", project_dir)

    assert spec is not None
    assert spec.image_name == "robotick-proj-linux-docker:linux-x64-deadbeef"


def test_load_docker_linux_x64_spec_defaults_target_platform_from_target(tmp_path):
    repo_root = tmp_path / "repo"
    project_dir = repo_root / "robots" / "proj"
    project_dir.mkdir(parents=True)
    (repo_root / "robotick" / "robotick-engine").mkdir(parents=True)

    (project_dir / "proj.project.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "engine": {
                        "local_path": "${PROJECT_DIR}/../../robotick/robotick-engine"
                    },
                }
            }
        )
    )
    (project_dir / "proj-face.model.yaml").write_text(
        yaml.safe_dump({"runtime": {"target_variant": "x86_64"}})
    )

    spec = load_docker_linux_x64_spec("proj", "proj-face", "linux", project_dir)

    assert spec is not None
    assert spec.family == "linux-x64"
    assert spec.supports_runtime is True


def test_build_docker_linux_x64_execs_inside_keepalive_container(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/robotick-ubuntu24.04-native-linux.Dockerfile",
        container_name="robotick-launcher-linux-x64-build-test",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
    )
    ensure_calls: list[tuple[DockerLinuxX64Spec, bool]] = []
    run_calls: list[list[str]] = []

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.ensure_running_docker_linux_container",
        lambda actual_spec, dry_run: ensure_calls.append((actual_spec, dry_run)),
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.os.getuid",
        lambda: 1234,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.os.getgid",
        lambda: 5678,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.run_subprocess",
        lambda cmd: run_calls.append(cmd),
    )

    build_docker_linux_x64(spec, dry_run=False)

    assert ensure_calls == [(spec, False)]
    assert run_calls == [
        [
            "docker",
            "exec",
            "--user",
            "1234:5678",
            "-e",
            "HOME=/tmp/robotick-home",
            "-w",
            "/tmp/repo",
            "robotick-launcher-linux-x64-build-test",
            "bash",
            "-lc",
            "if [[ -d /opt/robotick/project-target-cache/deps ]]; then rm -rf /tmp/repo/.launcher/proj/generated/proj_face/linux/deps && mkdir -p /tmp/repo/.launcher/proj/generated/proj_face/linux/deps && cp -a /opt/robotick/project-target-cache/deps/. /tmp/repo/.launcher/proj/generated/proj_face/linux/deps/; fi",
        ],
        [
            "docker",
            "exec",
            "--user",
            "1234:5678",
            "-e",
            "HOME=/tmp/robotick-home",
            "-w",
            "/tmp/repo/.launcher/proj/generated/proj_face/linux",
            "robotick-launcher-linux-x64-build-test",
            "bash",
            "-lc",
            "bash ./do_launcher_build.sh",
        ],
    ]


def test_ensure_docker_linux_x64_image_reuses_local_latest_by_default(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/robotick-ubuntu24.04-native-linux.Dockerfile",
        container_name="robotick-launcher-linux-x64-build-test",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
    )
    pull_calls: list[list[str]] = []

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.run_subprocess",
        lambda cmd: pull_calls.append(cmd),
    )
    monkeypatch.setattr(docker_linux_module, "_docker_image_exists", lambda image: True)

    ensure_docker_linux_x64_image(spec, dry_run=False)

    assert pull_calls == []


def test_ensure_running_docker_linux_x64_container_dry_run_tolerates_missing_docker(
    monkeypatch,
):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/robotick-ubuntu24.04-native-linux.Dockerfile",
        container_name="robotick-launcher-linux-x64-build-test",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
    )
    pull_calls: list[list[str]] = []

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.run_subprocess",
        lambda cmd: pull_calls.append(cmd),
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.subprocess.run",
        lambda *args, **kwargs: (_ for _ in ()).throw(FileNotFoundError("docker")),
    )

    ensure_running_docker_linux_x64_container(spec, dry_run=True)

    assert pull_calls == []


def test_deploy_docker_linux_x64_checks_binary_inside_keepalive_container(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/robotick-ubuntu24.04-native-linux.Dockerfile",
        container_name="robotick-launcher-linux-x64-build-test",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
    )
    ensure_calls: list[tuple[DockerLinuxX64Spec, bool]] = []
    run_calls: list[list[str]] = []

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.ensure_running_docker_linux_container",
        lambda actual_spec, dry_run: ensure_calls.append((actual_spec, dry_run)),
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.os.getuid",
        lambda: 1234,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.os.getgid",
        lambda: 5678,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.run_subprocess",
        lambda cmd: run_calls.append(cmd),
    )

    deploy_docker_linux_x64(spec, dry_run=False)

    assert ensure_calls == [(spec, False)]
    assert run_calls == [
        [
            "docker",
            "exec",
            "--user",
            "1234:5678",
            "-e",
            "HOME=/tmp/robotick-home",
            "-w",
            "/tmp/repo",
            "robotick-launcher-linux-x64-build-test",
            "bash",
            "-lc",
            "test -f /tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        ]
    ]


def test_stop_docker_linux_x64_kills_existing_binary_inside_container(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/robotick-ubuntu24.04-native-linux.Dockerfile",
        container_name="robotick-launcher-linux-x64-build-test",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
    )
    ensure_calls: list[tuple[DockerLinuxX64Spec, bool]] = []
    rm_calls: list[list[str]] = []

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.ensure_running_docker_linux_container",
        lambda actual_spec, dry_run: ensure_calls.append((actual_spec, dry_run)),
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.subprocess.run",
        lambda cmd, check=False, stdout=None, stderr=None: rm_calls.append(cmd),
    )

    stop_docker_linux_x64(spec, dry_run=False)

    assert ensure_calls == []
    assert rm_calls == [
        ["docker", "kill", "robotick-launcher-linux-x64-build-test-run"],
        ["docker", "rm", "-f", "robotick-launcher-linux-x64-build-test-run"],
    ]


def test_run_docker_linux_x64_execs_run_script_inside_keepalive_container(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/robotick-ubuntu24.04-native-linux.Dockerfile",
        container_name="robotick-launcher-linux-x64-build-test",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
    )
    ensure_calls: list[tuple[DockerLinuxX64Spec, bool]] = []
    run_calls: list[list[str]] = []

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.os.getuid",
        lambda: 1234,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.os.getgid",
        lambda: 5678,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.run_subprocess",
        lambda cmd: run_calls.append(cmd),
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux._docker_image_exists",
        lambda image: True,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux._runtime_device_args",
        lambda spec: [],
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux._runtime_group_add_args",
        lambda spec: ["--group-add", "29", "--group-add", "44"],
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.subprocess.run",
        lambda cmd, check=False, stdout=None, stderr=None: ensure_calls.append((spec, False)),
    )

    run_docker_linux_x64(spec, dry_run=False)

    assert ensure_calls == [(spec, False)]
    assert run_calls[0][:18] == [
        "docker",
        "run",
        "--name",
        "robotick-launcher-linux-x64-build-test-run",
        "--init",
        "--network",
        "host",
        "--user",
        "1234:5678",
        "--group-add",
        "29",
        "--group-add",
        "44",
        "-e",
        "HOME=/tmp/robotick-home",
        "-e",
        "XDG_RUNTIME_DIR=/tmp/robotick-xdg-runtime",
        "-v",
    ]
    assert run_calls[0][18] == "/tmp/repo:/tmp/repo"
    assert run_calls[0][19:24] == [
        "-w",
        "/tmp/repo/robots/proj",
        "ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        "bash",
        "-lc",
    ]
    assert "mkdir -p \"$HOME\" \"$XDG_RUNTIME_DIR\"" in run_calls[0][24]
    assert "chmod 700 \"$XDG_RUNTIME_DIR\" || true" in run_calls[0][24]
    assert (
        "export LD_LIBRARY_PATH=/tmp/repo/.launcher/proj/generated/proj_face/linux/build/robotick_engine/cpp:/tmp/repo/.launcher/proj/generated/proj_face/linux/build:$LD_LIBRARY_PATH"
        in run_calls[0][24]
    )
    assert "bash ./do_launcher_run.sh" in run_calls[0][24]


def test_runtime_docker_commands_forward_marked_python_env(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/robotick-ubuntu24.04-native-linux.Dockerfile",
        container_name="robotick-launcher-linux-x64-build-test",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
    )
    monkeypatch.setenv(
        docker_linux_module.DOCKER_PYTHON_ENV_FORWARD_FLAG,
        "1",
    )
    monkeypatch.setenv("PYTHONPATH", "/tmp/site-packages:/repo/robots/barr-e/python")
    monkeypatch.setenv("ROBOTICK_PYTHON_VENV", "/tmp/venv")
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.os.getuid",
        lambda: 1234,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.os.getgid",
        lambda: 5678,
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux._runtime_device_args",
        lambda spec: [],
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux._runtime_group_add_args",
        lambda spec: [],
    )

    run_command = docker_linux_module._docker_run_command(
        spec,
        "/tmp/repo/robots/proj",
        "bash ./do_launcher_run.sh",
    )
    exec_command = docker_linux_module._docker_exec_command(
        spec,
        "/tmp/repo/robots/proj",
        "bash ./do_launcher_run.sh",
        include_launcher_python_env=True,
    )

    assert "-e" in run_command
    assert "PYTHONPATH=/tmp/site-packages:/repo/robots/barr-e/python" in run_command
    assert "ROBOTICK_PYTHON_VENV=/tmp/venv" in run_command
    assert "PYTHONPATH=/tmp/site-packages:/repo/robots/barr-e/python" in exec_command
    assert "ROBOTICK_PYTHON_VENV=/tmp/venv" in exec_command


def test_prepare_runtime_shell_command_adds_alsa_bootstrap_for_local_runtime(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/robotick-ubuntu24.04-native-linux.Dockerfile",
        container_name="robotick-launcher-linux-x64-build-test",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
    )

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.Path.exists",
        lambda self: str(self) == "/dev/snd",
    )

    command = docker_linux_module._prepare_runtime_shell_command(
        spec, "bash ./do_launcher_run.sh"
    )

    assert "set -e" in command
    assert 'mkdir -p "$HOME" "$XDG_RUNTIME_DIR"' in command
    assert 'cat > "$HOME/.asoundrc"' in command
    assert 'slave.pcm "hw:0,0"' in command
    assert "bash ./do_launcher_run.sh" in command


def test_runtime_group_add_args_include_audio_video_render_when_present(monkeypatch):
    spec = _docker_linux_spec(
        family="linux-x64",
        image_name="ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest",
        dockerfile="/tmp/robotick-ubuntu24.04-native-linux.Dockerfile",
        container_name="robotick-launcher-linux-x64-build-test",
        launcher_dir="/tmp/repo/.launcher/proj/generated/proj_face/linux",
        binary_path="/tmp/repo/.launcher/proj/generated/proj_face/linux/build/proj-face",
        supports_runtime=True,
    )

    monkeypatch.setattr(
        docker_linux_module,
        "_lookup_group_gid",
        lambda name: {"audio": 29, "video": 44, "render": 992}.get(name),
    )

    def fake_exists(self):
        return str(self) in {"/dev/snd", "/dev/dri"}

    def fake_glob(self, pattern):
        if str(self) != "/dev":
            return []
        if pattern == "video*":
            return [Path("/dev/video0")]
        if pattern == "media*":
            return [Path("/dev/media0")]
        return []

    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.Path.exists", fake_exists
    )
    monkeypatch.setattr(
        "robotick.launcher.actions.launch.docker_linux.Path.glob", fake_glob
    )

    assert docker_linux_module._runtime_group_add_args(spec) == [
        "--group-add",
        "29",
        "--group-add",
        "44",
        "--group-add",
        "992",
    ]


def test_resolve_target_plan_uses_container_strategies_for_plain_linux_models(tmp_path):
    project_dir = tmp_path / "proj"
    project_dir.mkdir()
    (project_dir / "proj.project.yaml").write_text(
        yaml.safe_dump({"runtime": {"engine": {"local_path": "engine"}}})
    )
    (project_dir / "proj-face.model.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "target_platform": "linux",
                    "target_variant": "x86_64",
                    "preferred_host": "localhost",
                }
            }
        )
    )

    plan = resolve_target_plan("proj", "proj-face", "linux", project_dir)

    assert plan.build.strategy == CONTAINER_STRATEGY
    assert plan.deploy.strategy == CONTAINER_STRATEGY
    assert plan.run.strategy == CONTAINER_STRATEGY


def test_resolve_target_plan_ros2_stage_overrides_bind_handlers(tmp_path):
    project_dir = tmp_path / "proj"
    project_dir.mkdir()
    (project_dir / "proj.project.yaml").write_text(
        yaml.safe_dump({"runtime": {"engine": {"local_path": "engine"}}})
    )
    (project_dir / "proj-sim.model.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "target_platform": "linux",
                    "target_variant": "x86_64",
                    "custom_stages": {
                        "build_command": "./ros2/do_ros2_build.sh",
                        "run_command": "./ros2/do_ros2_run.sh",
                        "stop_command": "./ros2/do_ros2_stop.sh",
                    },
                }
            }
        )
    )

    plan = resolve_target_plan("proj", "proj-sim", "linux", project_dir)

    assert plan.build.build_handler is not None
    assert plan.deploy.deploy_handler is None
    assert plan.run.run_handler is not None
    assert plan.run.stop_handler is not None


def test_resolve_target_plan_ros2_handlers_execute_generated_scripts(
    monkeypatch, tmp_path
):
    project_dir = tmp_path / "proj"
    project_dir.mkdir()
    (project_dir / "proj.project.yaml").write_text(
        yaml.safe_dump({"runtime": {"engine": {"local_path": "engine"}}})
    )
    (project_dir / "proj-sim.model.yaml").write_text(
        yaml.safe_dump(
            {
                "runtime": {
                    "target_platform": "linux",
                    "target_variant": "x86_64",
                    "custom_stages": {
                        "run_command": "./ros2/do_ros2_run.sh",
                        "stop_command": "./ros2/do_ros2_stop.sh",
                    },
                }
            }
        )
    )

    launcher_dir = (
        project_dir / ".launcher" / "proj" / "generated" / "proj_sim" / "linux"
    )
    launcher_dir.mkdir(parents=True, exist_ok=True)
    run_script = launcher_dir / "do_launcher_run.sh"
    stop_script = launcher_dir / "do_launcher_stop.sh"
    run_script.write_text("#!/bin/bash\nset -e\n", encoding="utf-8")
    stop_script.write_text("#!/bin/bash\nset -e\n", encoding="utf-8")

    run_subprocess_calls: list[tuple[list[str], Path | None]] = []
    subprocess_run_calls: list[tuple[list[str], Path | None]] = []

    def _fake_run_subprocess(cmd, cwd=None, **kwargs):
        run_subprocess_calls.append((cmd, cwd))

        class _Proc:
            returncode = 0

        return _Proc()

    def _fake_subprocess_run(cmd, cwd=None, text=None, capture_output=None, check=None):
        subprocess_run_calls.append((cmd, cwd))

        class _Completed:
            returncode = 0
            stdout = ""
            stderr = ""

        return _Completed()

    monkeypatch.setattr(target_plan_module, "run_subprocess", _fake_run_subprocess)
    monkeypatch.setattr(target_plan_module.subprocess, "run", _fake_subprocess_run)

    plan = resolve_target_plan("proj", "proj-sim", "linux", project_dir)
    assert plan.run.run_handler is not None
    assert plan.run.stop_handler is not None
    plan.run.stop_handler(False)
    plan.run.run_handler(False)

    assert subprocess_run_calls == [
        (["bash", str(stop_script)], stop_script.parent),
    ]
    assert run_subprocess_calls == [
        (["bash", str(run_script)], run_script.parent),
    ]
