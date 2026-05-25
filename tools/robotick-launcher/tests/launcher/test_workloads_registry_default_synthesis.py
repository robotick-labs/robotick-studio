from pathlib import Path

import robotick.launcher.listen.routes_query as routes_query


def test_workloads_registry_reports_missing_primitive_defaults(
    tmp_path: Path, monkeypatch
):
    project_path = tmp_path / "demo.project.yaml"
    project_path.write_text("name: Demo\nschema_version: 1\n", encoding="utf-8")

    monkeypatch.setattr(
        routes_query,
        "_validate_core_model_yaml_against_schema",
        lambda *_args, **_kwargs: [],
    )
    monkeypatch.setattr(
        routes_query,
        "discover_workloads_metadata",
        lambda _cfg: [
            {
                "name": "DemoWorkload",
                "primitives": {
                    "float": {"category": "primitive", "primitive_kind": "number"},
                    "int": {"category": "primitive", "primitive_kind": "integer"},
                    "std::string": {"category": "primitive", "primitive_kind": "string"},
                    "bool": {"category": "primitive", "primitive_kind": "boolean"},
                },
                "structs": {
                    "config": {
                        "name": "DemoConfig",
                        "fields": [
                            {"name": "gain", "type": "float"},
                            {"name": "count", "type": "int"},
                            {"name": "label", "type": "std::string"},
                            {"name": "enabled", "type": "bool"},
                        ],
                    },
                    "inputs": {"name": "DemoInputs", "fields": []},
                    "outputs": {"name": "DemoOutputs", "fields": []},
                },
            }
        ],
    )

    result = routes_query.get_workloads_registry(project_path=project_path, target="linux")

    demo_config = next(t for t in result["types"] if t["name"] == "DemoConfig")
    defaults_by_field = {
        f["name"]: f.get("default_value") for f in demo_config.get("fields", [])
    }
    assert defaults_by_field["gain"] is None
    assert defaults_by_field["count"] is None
    assert defaults_by_field["label"] == ""
    assert defaults_by_field["enabled"] is None

    assert any(
        "Missing default_value in schema metadata for primitive field "
        "'DemoConfig.gain' (float, kind=number)."
        in err
        for err in result["validation_errors"]
    )
    assert any(
        "Missing default_value in schema metadata for primitive field "
        "'DemoConfig.count' (int, kind=integer)."
        in err
        for err in result["validation_errors"]
    )
    assert not any(
        "'DemoConfig.label' (std::string, kind=string)." in err
        for err in result["validation_errors"]
    )
    assert any(
        "Missing default_value in schema metadata for primitive field "
        "'DemoConfig.enabled' (bool, kind=boolean)."
        in err
        for err in result["validation_errors"]
    )
