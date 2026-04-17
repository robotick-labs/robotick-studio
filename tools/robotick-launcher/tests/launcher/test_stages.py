from __future__ import annotations

from robotick.launcher.actions.launch.stages import (
    DEFAULT_STAGE_SEQUENCE,
    LaunchStage,
    prerequisites_for,
)


def test_default_stage_sequence_is_documented_order():
    assert DEFAULT_STAGE_SEQUENCE == (
        LaunchStage.PREPARE_PROJECT_DOCKER,
        LaunchStage.PREPARE_PROJECT_WORKSPACE,
        LaunchStage.GENERATE,
        LaunchStage.BUILD,
        LaunchStage.DEPLOY,
        LaunchStage.RUN,
    )


def test_prerequisites_follow_forward_pipeline_order():
    assert prerequisites_for(LaunchStage.BUILD) == (
        LaunchStage.PREPARE_PROJECT_DOCKER,
        LaunchStage.PREPARE_PROJECT_WORKSPACE,
        LaunchStage.GENERATE,
    )
    assert prerequisites_for(LaunchStage.RUN) == DEFAULT_STAGE_SEQUENCE[:-1]


def test_stop_is_runtime_control_stage_not_forward_pipeline_stage():
    assert prerequisites_for(LaunchStage.STOP) == ()
