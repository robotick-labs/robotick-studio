from __future__ import annotations

from pathlib import Path

from robotick.launcher.actions.launch.prepare_project_docker import (
    _filter_base_image_apt_packages,
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
