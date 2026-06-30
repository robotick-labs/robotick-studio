from __future__ import annotations

from pathlib import Path

from robotick.launcher.actions.launch.target_plan import resolve_target_plan


def _write_project(tmp_path: Path, *, model_name: str = "proj-face", model_yaml: str) -> Path:
    project_path = tmp_path / "proj.project.yaml"
    project_path.write_text(
        "\n".join(
            [
                "models:",
                f"  - {model_name}.model.yaml",
                "runtime:",
                "  engine: ./engine",
            ]
        ),
        encoding="utf-8",
    )
    (tmp_path / "engine").mkdir(exist_ok=True)
    (tmp_path / f"{model_name}.model.yaml").write_text(model_yaml, encoding="utf-8")
    return project_path


def test_resolve_target_plan_uses_local_linux_defaults(tmp_path: Path) -> None:
    _write_project(
        tmp_path,
        model_yaml=
        "\n".join(
            [
                "runtime:",
                "  target_platform: linux",
                "  target_variant: x64",
            ]
        ),
    )

    plan = resolve_target_plan("proj", "proj-face", "linux", tmp_path)

    assert plan.target_platform == "linux"
    assert plan.target_variant == "x64"
    assert plan.build.strategy == "container"
    assert plan.deploy.strategy == "container"
    assert plan.run.strategy == "container"


def test_resolve_target_plan_custom_stage_scripts_override_handlers(tmp_path: Path) -> None:
    _write_project(
        tmp_path,
        model_yaml=
        "\n".join(
            [
                "runtime:",
                "  target_platform: linux",
                "  custom_stages:",
                "    build_command: colcon build",
                "    deploy_command: rsync deploy",
                "    run_command: ros2 launch demo",
                "    stop_command: pkill demo",
            ]
        ),
    )

    launcher_dir = tmp_path / ".launcher" / "proj" / "generated" / "proj_face" / "linux"
    launcher_dir.mkdir(parents=True)
    for script_name in (
        "do_launcher_build.sh",
        "do_launcher_deploy.sh",
        "do_launcher_run.sh",
        "do_launcher_stop.sh",
    ):
        (launcher_dir / script_name).write_text("#!/usr/bin/env bash\n", encoding="utf-8")

    plan = resolve_target_plan("proj", "proj-face", "linux", tmp_path)

    assert plan.build.build_handler is not None
    assert plan.deploy.deploy_handler is not None
    assert plan.run.run_handler is not None
    assert plan.run.stop_handler is not None
