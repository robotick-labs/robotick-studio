from __future__ import annotations

from pathlib import Path

from robotick.launcher.actions.launch.custom_stages import (
    custom_stage_can_skip_binary_requirement,
)
from robotick.launcher.actions.launch.run_profile import (
    _local_deploy_output_is_available,
)
from robotick.launcher.actions.launch.stages import CUSTOM_STAGE_OVERRIDE_MARKER


def test_custom_stage_output_can_replace_generated_binary_requirement(tmp_path: Path) -> None:
    launcher_dir = tmp_path / "launcher"
    launcher_dir.mkdir()
    binary_path = launcher_dir / "build" / "model-binary"
    (launcher_dir / "do_launcher_run.sh").write_text(
        "\n".join(
            [
                "#!/bin/bash",
                CUSTOM_STAGE_OVERRIDE_MARKER,
                "exec ./ros2/do_ros2_run.sh",
            ]
        ),
        encoding="utf-8",
    )

    assert custom_stage_can_skip_binary_requirement(launcher_dir) is True
    assert _local_deploy_output_is_available(launcher_dir, binary_path) is True


def test_missing_binary_still_fails_without_custom_stage_output(tmp_path: Path) -> None:
    launcher_dir = tmp_path / "launcher"
    launcher_dir.mkdir()
    binary_path = launcher_dir / "build" / "model-binary"

    assert custom_stage_can_skip_binary_requirement(launcher_dir) is False
    assert _local_deploy_output_is_available(launcher_dir, binary_path) is False
