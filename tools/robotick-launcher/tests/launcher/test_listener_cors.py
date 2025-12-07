from pathlib import Path

from fastapi.testclient import TestClient

from robotick.launcher.listen.listener import create_app


PROJECT_FILE = (
    Path(__file__).resolve().parents[1]  # tools/.../tests
    / "test_data"
    / "test-project"
    / "test-project.project.yaml"
)


def _client() -> TestClient:
    return TestClient(create_app())


def test_cors_echoes_localhost_origin() -> None:
    client = _client()
    response = client.get(
        "/query/list-project-models",
        params={"project_path": str(PROJECT_FILE)},
        headers={"Origin": "http://localhost:5173"},
    )

    assert response.status_code == 200
    assert (
        response.headers.get("access-control-allow-origin")
        == "http://localhost:5173"
    )


def test_cors_allows_file_protocol_origin() -> None:
    client = _client()
    response = client.get(
        "/query/list-project-models",
        params={"project_path": str(PROJECT_FILE)},
        headers={"Origin": "null"},
    )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "null"


def test_cors_rejects_unknown_origins() -> None:
    client = _client()
    response = client.get(
        "/query/list-project-models",
        params={"project_path": str(PROJECT_FILE)},
        headers={"Origin": "http://example.com"},
    )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") is None


def test_missing_project_returns_404_with_cors_headers() -> None:
    client = _client()
    response = client.get(
        "/query/list-project-models",
        params={"project_path": "does-not-exist.project.yaml"},
        headers={"Origin": "http://localhost:5173"},
    )

    assert response.status_code == 404
    assert (
        response.headers.get("access-control-allow-origin")
        == "http://localhost:5173"
    )
    assert "Project file not found" in response.text
