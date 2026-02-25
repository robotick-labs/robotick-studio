from pathlib import Path

from fastapi.testclient import TestClient

from robotick.launcher.listen.listener import create_app


def test_get_project_rc_settings_preserves_project_relative_asset_paths(
    tmp_path: Path,
) -> None:
    project_path = tmp_path / "demo.project.yaml"
    project_path.write_text("name: demo\n", encoding="utf-8")

    rc_path = tmp_path / "demo.rc.yaml"
    rc_path.write_text(
        """
modules:
  - type: viewer/three-js
    config:
      models:
        - id: body
          url: assets/barr-e-model.glb
""".strip()
        + "\n",
        encoding="utf-8",
    )

    client = TestClient(create_app())
    response = client.get(
        "/query/get-project-rc-settings",
        params={"project_path": str(project_path)},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["modules"][0]["config"]["models"][0]["url"] == "assets/barr-e-model.glb"
