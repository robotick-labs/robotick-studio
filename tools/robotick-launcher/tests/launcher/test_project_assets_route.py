from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from robotick.launcher.listen.listener import create_app


def _client() -> TestClient:
    return TestClient(create_app())


def _write_project_file(project_dir: Path, name: str = "demo") -> Path:
    project_path = project_dir / f"{name}.project.yaml"
    project_path.write_text("name: demo\n", encoding="utf-8")
    return project_path


def test_project_assets_serves_in_project_file(tmp_path: Path) -> None:
    project_path = _write_project_file(tmp_path)
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    asset_path = assets_dir / "robot.glb"
    expected = b"glb-bytes"
    asset_path.write_bytes(expected)

    client = _client()
    response = client.get(
        "/query/project-assets/assets/robot.glb",
        params={"project_path": str(project_path)},
    )

    assert response.status_code == 200
    assert response.content == expected


def test_project_assets_rejects_traversal(tmp_path: Path) -> None:
    project_path = _write_project_file(tmp_path)
    outside = tmp_path.parent / "outside.txt"
    outside.write_text("outside", encoding="utf-8")

    client = _client()
    response = client.get(
        "/query/project-assets/%2E%2E/outside.txt",
        params={"project_path": str(project_path)},
    )

    assert response.status_code == 400
    assert "asset_path must be under the project folder" in response.text


def test_project_assets_rejects_symlink_escape(tmp_path: Path) -> None:
    project_path = _write_project_file(tmp_path)
    outside = tmp_path.parent / "outside.bin"
    outside.write_bytes(b"outside")

    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    symlink_path = assets_dir / "escape.bin"
    try:
        symlink_path.symlink_to(outside)
    except OSError as exc:  # pragma: no cover - platform/filesystem dependent
        pytest.skip(f"Symlink creation unavailable: {exc}")

    client = _client()
    response = client.get(
        "/query/project-assets/assets/escape.bin",
        params={"project_path": str(project_path)},
    )

    assert response.status_code == 400
    assert "asset_path must be under the project folder" in response.text


def test_project_assets_missing_file_returns_404(tmp_path: Path) -> None:
    project_path = _write_project_file(tmp_path)

    client = _client()
    response = client.get(
        "/query/project-assets/assets/missing.glb",
        params={"project_path": str(project_path)},
    )

    assert response.status_code == 404
    assert "Asset file not found" in response.text
