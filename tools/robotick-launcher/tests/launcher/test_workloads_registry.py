from pathlib import Path
import json

from robotick.launcher.listen.routes_query import get_workloads_registry


_TESTS_ROOT = Path(__file__).resolve().parents[1]
TEST_PROJECT = _TESTS_ROOT / "test_data" / "test-project" / "test-project.project.yaml"
GOLDEN_PATH = _TESTS_ROOT / "test_data" / "workloads_registry.golden.json"
LATEST_PATH = _TESTS_ROOT / "test_data" / "workloads_registry.latest.json"


def test_workloads_registry_matches_golden():
    result = get_workloads_registry(project_path=TEST_PROJECT, target="linux")
    # Normalize the project path so tests stay stable across repos.
    result["project"] = result["project"].split("/")[-1]
    serialized = json.dumps(result, indent=2) + "\n"

    LATEST_PATH.write_text(serialized, encoding="utf-8")

    if not GOLDEN_PATH.exists():
        GOLDEN_PATH.write_text(serialized, encoding="utf-8")
        return

    expected = GOLDEN_PATH.read_text(encoding="utf-8")
    assert serialized == expected, (
        f"Workloads registry output does not match golden file: {GOLDEN_PATH}\n"
        "Review differences and update the golden if intentional."
    )
