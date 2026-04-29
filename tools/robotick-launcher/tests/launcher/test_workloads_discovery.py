import json
from pathlib import Path

import pytest

from robotick.launcher.discover_workloads import discover_workloads_metadata
from robotick.launcher.listen.routes_query import get_workloads_registry


class _MinimalConfig:
    def __init__(
        self,
        base_dir: Path,
        workload_roots,
        engine_root: str | None = None,
        target_platform="linux",
        dry_run=False,
    ):
        self.base_dir = Path(base_dir).resolve()
        runtime = {"workload_sources": [{"local_path": root} for root in workload_roots]}
        if engine_root:
            runtime["engine"] = {"local_path": engine_root}
        self.runtime = runtime
        self.target_platform = target_platform
        self.dry_run = dry_run
        self.launcher_dir = self.base_dir / ".launcher"

def _normalize_registry_payload_for_golden(payload: dict) -> dict:
    normalized = dict(payload)
    if "project" in normalized:
        normalized["project"] = "__PROJECT_PATH__"
    return normalized


def test_discover_workloads_golden(pytestconfig):
    """
    Validate that discovered workloads metadata matches the stored golden JSON for the sample workload roots.
    
    Runs discovery using a minimal configuration, writes the discovery output to test_data/workloads_discovery.latest.json, creates test_data/workloads_discovery.golden.json with the output if it does not exist, and asserts that the discovered JSON equals the golden file's contents.
    """
    base_dir = Path(__file__).parents[1]
    project_path = (
        base_dir / "test_data" / "test-project" / "test-project.project.yaml"
    ).resolve()
    discovered_obj = get_workloads_registry(
        project_path=project_path,
        target="linux",
    )
    discovered = json.dumps(
        _normalize_registry_payload_for_golden(discovered_obj), indent=2
    ) + "\n"

    # Always write latest output to a separate non-golden file
    output_path = base_dir / "test_data" / "workloads_discovery.latest.json"
    output_path.write_text(discovered, encoding="utf-8")
    
    golden_dir = base_dir / "test_data"
    golden_dir.mkdir(parents=True, exist_ok=True)
    golden_path = golden_dir / "workloads_discovery.golden.json"

    if not golden_path.exists():
        golden_path.write_text(discovered, encoding="utf-8")
        return

    expected = golden_path.read_text(encoding="utf-8")
    assert discovered == expected, (
        f"Discovered workloads metadata does not match golden-file: {golden_path}"
        "Delete the golden-file refresh."
    )


def test_discover_workload_contracts_from_quoted_includes(tmp_path: Path):
    """
    Ensure workload contract structs can be discovered from local quoted includes
    when they are not defined directly in the workload .cpp file.
    """
    workload_root = tmp_path / "workloads"
    (workload_root / "systems").mkdir(parents=True, exist_ok=True)
    (workload_root / "mind").mkdir(parents=True, exist_ok=True)

    (workload_root / "systems" / "MyContract.h").write_text(
        """
namespace robotick
{
    struct MyConfig
    {
        float affect_weight = 0.35f;
    };

    struct MyInputs
    {
        bool has_human = false;
    };

    struct MyOutputs
    {
        float joy = 0.0f;
    };
}
""".strip()
        + "\n",
        encoding="utf-8",
    )

    (workload_root / "mind" / "MyWorkload.cpp").write_text(
        """
#include "systems/MyContract.h"

namespace robotick
{
    struct MyWorkload
    {
        MyConfig config;
        MyInputs inputs;
        MyOutputs outputs;
    };
}
""".strip()
        + "\n",
        encoding="utf-8",
    )

    cfg = _MinimalConfig(base_dir=tmp_path, workload_roots=[str(workload_root)])
    discovered = discover_workloads_metadata(cfg)
    workload_entry = next((entry for entry in discovered if entry["name"] == "MyWorkload"), None)
    assert workload_entry is not None

    structs = workload_entry.get("structs", {})
    assert structs["config"]["name"] == "MyConfig"
    assert structs["inputs"]["name"] == "MyInputs"
    assert structs["outputs"]["name"] == "MyOutputs"
    assert any(field["name"] == "affect_weight" for field in structs["config"]["fields"])
    assert any(field["name"] == "has_human" for field in structs["inputs"]["fields"])
    assert any(field["name"] == "joy" for field in structs["outputs"]["fields"])


def test_discovery_recursively_adds_registered_referenced_types(tmp_path: Path):
    workload_root = tmp_path / "workloads"
    workload_root.mkdir(parents=True, exist_ok=True)

    (workload_root / "NestedWorkload.cpp").write_text(
        """
namespace robotick
{
    ROBOTICK_REGISTER_PRIMITIVE(float)

    struct ChildType
    {
        float gain = 1.0f;
    };

    struct NestedConfig
    {
        ChildType child;
    };

    struct NestedWorkload
    {
        NestedConfig config;
    };

    ROBOTICK_REGISTER_STRUCT_BEGIN(ChildType)
    ROBOTICK_STRUCT_FIELD(ChildType, float, gain)
    ROBOTICK_REGISTER_STRUCT_END(ChildType)

    ROBOTICK_REGISTER_STRUCT_BEGIN(NestedConfig)
    ROBOTICK_STRUCT_FIELD(NestedConfig, ChildType, child)
    ROBOTICK_REGISTER_STRUCT_END(NestedConfig)
}
""".strip()
        + "\n",
        encoding="utf-8",
    )

    cfg = _MinimalConfig(base_dir=tmp_path, workload_roots=[str(workload_root)])
    discovered = discover_workloads_metadata(cfg)
    entry = next(e for e in discovered if e["name"] == "NestedWorkload")
    structs = entry["structs"]
    assert "config" in structs
    assert structs["config"]["name"] == "NestedConfig"
    assert "ChildType" in structs


def test_discovery_reports_schema_error_for_missing_referenced_registration(tmp_path: Path):
    workload_root = tmp_path / "workloads"
    workload_root.mkdir(parents=True, exist_ok=True)

    (workload_root / "BrokenWorkload.cpp").write_text(
        """
namespace robotick
{
    struct BrokenConfig
    {
        UnknownType missing;
    };

    struct BrokenWorkload
    {
        BrokenConfig config;
    };

    ROBOTICK_REGISTER_STRUCT_BEGIN(BrokenConfig)
    ROBOTICK_STRUCT_FIELD(BrokenConfig, UnknownType, missing)
    ROBOTICK_REGISTER_STRUCT_END(BrokenConfig)
}
""".strip()
        + "\n",
        encoding="utf-8",
    )

    cfg = _MinimalConfig(base_dir=tmp_path, workload_roots=[str(workload_root)])
    discovered = discover_workloads_metadata(cfg)
    entry = next(e for e in discovered if e["name"] == "BrokenWorkload")
    assert "schema_error" in entry
    assert "UnknownType" in entry["schema_error"]


def test_discovery_reports_schema_error_for_conflicting_registrations(tmp_path: Path):
    workload_root = tmp_path / "workloads"
    workload_root.mkdir(parents=True, exist_ok=True)

    (workload_root / "ConflictA.cpp").write_text(
        """
namespace robotick
{
    ROBOTICK_REGISTER_PRIMITIVE(float)

    ROBOTICK_REGISTER_STRUCT_BEGIN(SharedType)
    ROBOTICK_STRUCT_FIELD(SharedType, float, a)
    ROBOTICK_REGISTER_STRUCT_END(SharedType)
}
""".strip()
        + "\n",
        encoding="utf-8",
    )

    (workload_root / "ConflictB.cpp").write_text(
        """
namespace robotick
{
    ROBOTICK_REGISTER_PRIMITIVE(float)

    ROBOTICK_REGISTER_STRUCT_BEGIN(SharedType)
    ROBOTICK_STRUCT_FIELD(SharedType, float, b)
    ROBOTICK_REGISTER_STRUCT_END(SharedType)

    struct ConflictConfig
    {
        SharedType shared;
    };

    struct ConflictWorkload
    {
        ConflictConfig config;
    };

    ROBOTICK_REGISTER_STRUCT_BEGIN(ConflictConfig)
    ROBOTICK_STRUCT_FIELD(ConflictConfig, SharedType, shared)
    ROBOTICK_REGISTER_STRUCT_END(ConflictConfig)
}
""".strip()
        + "\n",
        encoding="utf-8",
    )

    cfg = _MinimalConfig(base_dir=tmp_path, workload_roots=[str(workload_root)])
    with pytest.raises(ValueError, match="Conflicting struct registrations"):
        discover_workloads_metadata(cfg)
