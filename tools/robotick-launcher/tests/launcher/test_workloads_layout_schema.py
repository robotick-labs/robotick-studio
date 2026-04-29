import json
from pathlib import Path

import jsonschema

from robotick.launcher.listen.routes_query import get_workloads_registry


_TESTS_ROOT = Path(__file__).resolve().parents[1]
_TEST_PROJECT = _TESTS_ROOT / "test_data" / "test-project" / "test-project.project.yaml"
_SCHEMA_PATH = (
    _TESTS_ROOT
    / "test_data"
    / "robotick"
    / "robotick-engine"
    / "schemas"
    / "workloads_layout.schema.json"
)


def _load_schema():
    return json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))


def test_design_time_registry_payload_validates_against_layout_schema():
    payload = get_workloads_registry(project_path=_TEST_PROJECT, target="linux")
    jsonschema.validate(instance=payload, schema=_load_schema())


def test_runtime_like_layout_payload_validates_against_layout_schema():
    payload = {
        "workloads_buffer_size_used": 128,
        "process_memory_used": 8192,
        "engine_session_id": "abc123",
        "engine": {
            "type": "EngineInfo",
            "offset_within_container": 0,
        },
        "workloads": [
            {
                "name": "demo_workload",
                "type": "DemoWorkload",
                "offset_within_container": 64,
                "inputs": {
                    "type": "DemoInputs",
                    "offset_within_container": 0,
                },
                "outputs": {
                    "type": "DemoOutputs",
                    "offset_within_container": 16,
                },
                "stats_offset_within_container": 120,
            }
        ],
        "types": [
            {
                "name": "DemoInputs",
                "type_category": "struct",
                "fields": [
                    {
                        "name": "gain",
                        "type": "float",
                        "element_count": 1,
                    }
                ],
                "size": 4,
                "alignment": 4,
            },
            {
                "name": "float",
                "type_category": "primitive",
                "primitive_kind": "number",
                "size": 4,
                "alignment": 4,
            },
        ],
        "writable_inputs": [],
    }
    jsonschema.validate(instance=payload, schema=_load_schema())
