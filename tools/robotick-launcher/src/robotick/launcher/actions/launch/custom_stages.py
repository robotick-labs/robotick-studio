from __future__ import annotations

from pathlib import Path

from robotick.launcher.actions.launch.stages import (
    CUSTOM_STAGE_OVERRIDE_MARKER,
    CUSTOM_STAGE_SCRIPT_NAME_BY_STAGE,
    LaunchStage,
)


def custom_stage_script_path(launcher_dir: Path, stage: LaunchStage) -> Path:
    return launcher_dir / CUSTOM_STAGE_SCRIPT_NAME_BY_STAGE[stage]


def has_custom_stage_script(launcher_dir: Path, stage: LaunchStage) -> bool:
    script_path = custom_stage_script_path(launcher_dir, stage)
    try:
        content = script_path.read_text(encoding="utf-8")
    except OSError:
        return False
    return CUSTOM_STAGE_OVERRIDE_MARKER in content


def custom_stage_can_skip_binary_requirement(launcher_dir: Path) -> bool:
    return has_custom_stage_script(launcher_dir, LaunchStage.BUILD) or has_custom_stage_script(
        launcher_dir,
        LaunchStage.RUN,
    )
