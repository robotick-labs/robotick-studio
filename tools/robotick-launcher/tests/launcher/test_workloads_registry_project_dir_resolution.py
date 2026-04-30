from pathlib import Path

from robotick.launcher.listen.routes_query import get_workloads_registry


def test_workloads_registry_resolves_project_dir_tokens(tmp_path: Path):
    project_dir = tmp_path / "demo-project"
    project_dir.mkdir(parents=True)

    workload_dir = project_dir / "demo-workloads"
    workload_dir.mkdir(parents=True)
    workload_cpp = workload_dir / "DemoWorkload.cpp"
    workload_cpp.write_text(
        "\n".join(
            [
                "struct DemoConfig { bool enabled = true; };",
                "struct DemoInputs { float gain = 0.5f; };",
                "struct DemoOutputs { bool ready = false; };",
                "struct DemoWorkload {};",
            ]
        ),
        encoding="utf-8",
    )

    project_path = project_dir / "demo-project.project.yaml"
    project_path.write_text(
        "\n".join(
            [
                'name: "Demo Project"',
                "schema_version: 1",
                "runtime:",
                "  workload_sources:",
                "    - id: demo-workloads",
                "      local_path: ${PROJECT_DIR}/demo-workloads",
            ]
        ),
        encoding="utf-8",
    )

    result = get_workloads_registry(project_path=project_path, target="linux")

    assert result["target"] == "linux"
    assert len(result["workloads"]) == 1
    assert result["workloads"][0]["type"] == "DemoWorkload"
