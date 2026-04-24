from __future__ import annotations

import json
from pathlib import Path

import yaml

from robotick.launcher.actions.launch import prepare_project_docker as prepare_project_docker_module
from robotick.launcher.actions.launch.prepare_project_docker import (
    _filter_base_image_apt_packages,
    prepare_project_docker,
    project_cache_materialize_shell,
)


def test_filter_base_image_apt_packages_drops_shared_cross_toolchain_deps():
    assert _filter_base_image_apt_packages(
        "linux-arm64",
        ["libopencv-dev", "libsdl2-dev", "custom-sensor-sdk"],
    ) == ["custom-sensor-sdk"]


def test_filter_base_image_apt_packages_keeps_only_project_specific_native_extras():
    assert _filter_base_image_apt_packages(
        "linux-x64",
        ["libyaml-cpp-dev", "robotick-extra-dev", "xvfb"],
    ) == ["robotick-extra-dev"]


def test_project_cache_materialize_shell_quotes_paths():
    command = project_cache_materialize_shell(
        "/tmp/workspace with spaces/generated/linux",
        subdir="deps",
    )

    assert "/opt/robotick/project-target-cache/deps" in command
    assert "'/tmp/workspace with spaces/generated/linux/deps'" in command


def test_prepare_project_docker_reuses_shared_base_when_no_project_specific_image_deps(
    tmp_path, monkeypatch
):
    base_dir = tmp_path / "robots" / "demo-robot"
    base_dir.mkdir(parents=True)
    (base_dir / "demo-robot.project.yaml").write_text(
        yaml.safe_dump({"runtime": {"engine": {"local_path": "../engine"}}})
    )
    (base_dir / "demo-robot-brain.model.yaml").write_text(
        yaml.safe_dump({"runtime": {"target_platform": "linux", "target_variant": "x86_64"}})
    )

    def collect_image_requirement_summary(*_args, **_kwargs):
        return ([], [], [{"model": "demo-robot-brain"}])

    monkeypatch.setattr(
        prepare_project_docker_module,
        "_collect_image_requirement_summary",
        collect_image_requirement_summary,
    )

    info = prepare_project_docker(
        "demo-robot",
        base_dir,
        target="linux",
        models=["demo-robot-brain"],
    )

    assert info is not None
    assert (
        info.image_name
        == "ghcr.io/robotick-labs/robotick-ubuntu24.04-native-linux:latest"
    )
    payload = json.loads(info.metadata_path.read_text(encoding="utf-8"))
    assert payload["uses_base_image_directly"] is True
    assert payload["image_name"] == info.image_name
