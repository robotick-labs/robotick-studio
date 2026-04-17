"""Canonical launcher stage definitions and default ordering.

These stages are the documented contract for launcher orchestration. They serve
two purposes:

- make the discrete pipeline visible in code instead of relying on ad hoc
  string literals
- provide one obvious place to document the default sequential dependency order

Not every invocation executes every stage. For example, build-profile stops
after BUILD, and STOP is a runtime-control stage rather than part of the normal
forward pipeline. But the enum defines the common stage vocabulary that the
launcher, tests, and docs should all speak.
"""

from __future__ import annotations

from enum import StrEnum


class LaunchStage(StrEnum):
    PREPARE_PROJECT_DOCKER = "prepare-project-docker"
    PREPARE_PROJECT_WORKSPACE = "prepare-project-workspace"
    GENERATE = "generate"
    BUILD = "build"
    DEPLOY = "deploy"
    RUN = "run"
    STOP = "stop"


# The forward pipeline launcher follows when preparing a runnable model.
DEFAULT_STAGE_SEQUENCE: tuple[LaunchStage, ...] = (
    LaunchStage.PREPARE_PROJECT_DOCKER,
    LaunchStage.PREPARE_PROJECT_WORKSPACE,
    LaunchStage.GENERATE,
    LaunchStage.BUILD,
    LaunchStage.DEPLOY,
    LaunchStage.RUN,
)


def prerequisites_for(stage: LaunchStage) -> tuple[LaunchStage, ...]:
    """Return the default upstream stages that must run before `stage`."""

    if stage == LaunchStage.STOP:
        return ()

    if stage not in DEFAULT_STAGE_SEQUENCE:
        return ()

    index = DEFAULT_STAGE_SEQUENCE.index(stage)
    return DEFAULT_STAGE_SEQUENCE[:index]
