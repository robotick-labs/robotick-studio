from robotick.launcher.listen.routes_query import get_workloads_registry

from pathlib import Path


_TESTS_ROOT = Path(__file__).resolve().parents[1]
TEST_PROJECT = _TESTS_ROOT / "test_data" / "test-project" / "test-project.project.yaml"


def test_workloads_registry_matches_golden():
    result = get_workloads_registry(project_path=TEST_PROJECT, target="linux")
    assert result["target"] == "linux"
    assert result["project"].endswith("test-project.project.yaml")
    assert isinstance(result["workloads"], list)
    assert len(result["workloads"]) > 0
    first = result["workloads"][0]
    assert isinstance(first.get("type"), str)
    assert "name" not in first
    assert isinstance(result.get("types"), list)
    assert len(result["types"]) > 0
    assert isinstance(result.get("writable_inputs"), list)
