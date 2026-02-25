from __future__ import annotations

from pathlib import Path

import pytest

from robotick.launcher.config import Config


@pytest.fixture
def make_test_config():
    def _make(
        base_dir: Path,
        *,
        project: str = "test-project",
        model: str | None = None,
        target: str | None = None,
        dry_run: bool = True,
        stub_install: bool = False,
    ) -> Config:
        return Config(
            project=project,
            model=model,
            target=target,
            base_dir=base_dir,
            dry_run=dry_run,
            stub_install=stub_install,
        )

    return _make
