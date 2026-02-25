import json
from pathlib import Path

import pytest

from robotick.launcher.discover_workloads import discover_workloads_metadata_as_json


class _MinimalConfig:
    def __init__(self, base_dir: Path, workload_roots, target_platform="linux", dry_run=False):
        self.base_dir = Path(base_dir).resolve()
        self.runtime = {"workload_sources": [{"local_path": root} for root in workload_roots]}
        self.target_platform = target_platform
        self.dry_run = dry_run
        self.launcher_dir = self.base_dir / ".launcher"

def test_discover_workloads_golden(pytestconfig):
    """
    Validate that discovered workloads metadata matches the stored golden JSON for the sample workload roots.
    
    Runs discovery using a minimal configuration, writes the discovery output to test_data/workloads_discovery.latest.json, creates test_data/workloads_discovery.golden.json with the output if it does not exist, and asserts that the discovered JSON equals the golden file's contents.
    """
    base_dir = Path(__file__).parents[1]
    workload_roots = [
        "test_data/robotick/robotick-core-workloads"
    ]

    cfg = _MinimalConfig(base_dir=base_dir, workload_roots=workload_roots)

    discovered = discover_workloads_metadata_as_json(cfg) + "\n"

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
    discovered = json.loads(discover_workloads_metadata_as_json(cfg))
    workload_entry = next((entry for entry in discovered if entry["name"] == "MyWorkload"), None)
    assert workload_entry is not None

    structs = workload_entry.get("structs", {})
    assert structs["config"]["name"] == "MyConfig"
    assert structs["inputs"]["name"] == "MyInputs"
    assert structs["outputs"]["name"] == "MyOutputs"
    assert any(field["name"] == "affect_weight" for field in structs["config"]["fields"])
    assert any(field["name"] == "has_human" for field in structs["inputs"]["fields"])
    assert any(field["name"] == "joy" for field in structs["outputs"]["fields"])
