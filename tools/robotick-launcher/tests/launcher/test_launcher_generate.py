import shutil
import difflib
import os
import re
import sys
from pathlib import Path
from typer.testing import CliRunner
import subprocess
import pytest
from types import SimpleNamespace

from robotick.launcher.cli import create_app
from robotick.launcher.actions.launch.generate_model_cpp import (
    prepare_codegen_model_data,
)

runner = CliRunner()
app = create_app()

TESTS_ROOT = Path(__file__).resolve().parents[1]
TEST_BASE = TESTS_ROOT / "test_data" / "test-project"
OUTPUT_DIR_BASE = TEST_BASE / ".launcher"
GOLDEN_DIR_BASE = TEST_BASE / ".launcher-golden"
LAUNCHER_SRC = Path(__file__).resolve().parents[2] / "src"


def _launcher_env():
    env = os.environ.copy()
    existing = env.get("PYTHONPATH")
    extra = str(LAUNCHER_SRC)
    env["PYTHONPATH"] = extra if not existing else f"{extra}{os.pathsep}{existing}"
    return env


def reset_output_dir(output_dir: Path):
    if output_dir.exists():
        shutil.rmtree(output_dir)


def normalize_lines(lines):
    return [line.rstrip("\n") for line in lines]


def normalize_workload_paths(text: str) -> str:
    """
    Normalize absolute paths that point to the robotick-core-workloads directory by replacing them with a stable placeholder.

    Parameters:
        text (str): Input text potentially containing absolute workload paths.

    Returns:
        str: A copy of `text` where occurrences of paths ending with
        `tests/test_data/robotick/robotick-core-workloads` are replaced with
        `__WORKLOADS_ROOT__/tests/test_data/robotick/robotick-core-workloads`.
    """
    pattern = re.compile(r"[^ \n\r\t]*tests/test_data/robotick/robotick-core-workloads")
    return pattern.sub(
        "__WORKLOADS_ROOT__/tests/test_data/robotick/robotick-core-workloads", text
    )


def _list_files(dir_path: Path):
    """
    Collects all files under the given directory and returns their paths relative to that directory.

    Parameters:
        dir_path (Path): Directory whose files should be listed.

    Returns:
        List[Path]: Deterministically sorted list of file paths relative to `dir_path`.

    Notes:
        Fails the test via `pytest.fail` if `dir_path` does not exist or is not a directory.
    """
    if not dir_path.exists() or not dir_path.is_dir():
        pytest.fail(f"❌ Path is missing or not a directory: {dir_path}", pytrace=False)
    # Collect, filter to files, then sort deterministically
    all_paths = list(dir_path.rglob("*"))
    file_paths = [p for p in all_paths if p.is_file()]
    file_paths_rel = sorted(
        (p.relative_to(dir_path) for p in file_paths), key=lambda p: str(p)
    )
    return file_paths_rel


def assert_dirs_match(output_dir: Path, golden_dir: Path):
    """
    Recursively assert that two directories contain the same structure and content.
    """
    output_files = _list_files(output_dir)
    golden_files = _list_files(golden_dir)

    # Explicitly fail if either side is empty
    if not output_files or not golden_files:
        pytest.fail(
            f"❌ One or both directories contain zero files.\n"
            f"- {output_dir}: {len(output_files)} files\n"
            f"- {golden_dir}: {len(golden_files)} files",
            pytrace=False,
        )

    if output_files != golden_files:
        msg = (
            f"\n📂 Directory structure mismatch:\n"
            f"Expected:\n  {golden_files}\nGot:\n  {output_files}"
        )
        pytest.fail(msg, pytrace=False)

    for rel_path in output_files:
        out_file = output_dir / rel_path
        gold_file = golden_dir / rel_path

        with open(out_file, "r") as f1, open(gold_file, "r") as f2:
            out_text = f1.read()
            gold_text = f2.read()
            if rel_path == Path("registry/generated_workload_deps.cmake"):
                out_text = normalize_workload_paths(out_text)
                gold_text = normalize_workload_paths(gold_text)

            out_lines = normalize_lines(out_text.splitlines())
            gold_lines = normalize_lines(gold_text.splitlines())

            if out_lines != gold_lines:
                diff = "\n".join(
                    difflib.unified_diff(
                        gold_lines,
                        out_lines,
                        fromfile=f"expected/{rel_path}",
                        tofile=f"actual/{rel_path}",
                        lineterm="",
                    )
                )

                # Limit diff length for big files (optional)
                diff_lines = diff.splitlines()
                max_lines = 80
                if len(diff_lines) > max_lines:
                    diff = (
                        "\n".join(diff_lines[:max_lines])
                        + f"\n... (diff truncated, {len(diff_lines)} total lines)"
                    )

                pytest.fail(
                    f"\n📝 File content mismatch: {rel_path}\n\n{diff}", pytrace=False
                )


@pytest.mark.parametrize(
    "target,model",
    [
        ("linux", "test-project-brain"),
        ("esp32", "test-project-spine"),
    ],
)
def test_launcher_generate(target, model):

    output_subdir = (
        Path("test_project")
        / "generated"
        / model.replace("-", "_")
        / target.replace("-", "_")
    )

    OUTPUT_DIR = OUTPUT_DIR_BASE / output_subdir
    GOLDEN_DIR = GOLDEN_DIR_BASE / output_subdir

    reset_output_dir(OUTPUT_DIR)

    cmd = [
        sys.executable,
        "-m",
        "robotick.launcher.cli",
        "generate",
        "test-project",
        model,
        target,
        "--base-dir",
        str(TEST_BASE),
        "--stub-install",
    ]
    print(f"💻 Running subprocess: {' '.join(cmd)}")

    subprocess.run(cmd, check=True, env=_launcher_env())

    assert_dirs_match(OUTPUT_DIR, GOLDEN_DIR)


def test_prepare_codegen_model_data_flattens_nested_field_entries():
    cfg = SimpleNamespace(
        model={
            "workloads": [
                {
                    "name": "mind-workload",
                    "type": "MindWorkload",
                    "config": {
                        "initial_expressive_state": {
                            "joy": 0.85,
                            "calm": 0.8,
                        },
                        "min_focus_duration_s": 1.0,
                    },
                    "inputs": {
                        "boot": {
                            "is_fresh_start": True,
                        },
                        "scene": "home",
                    },
                }
            ]
        }
    )

    workloads, connections, remote_models, telemetry = prepare_codegen_model_data(cfg)

    assert len(workloads) == 1
    assert workloads[0]["config_entries"] == [
        {"key": "initial_expressive_state.joy", "value": 0.85},
        {"key": "initial_expressive_state.calm", "value": 0.8},
        {"key": "min_focus_duration_s", "value": 1.0},
    ]
    assert workloads[0]["input_entries"] == [
        {"key": "boot.is_fresh_start", "value": True},
        {"key": "scene", "value": "home"},
    ]
    assert connections == []
    assert remote_models == []
    assert telemetry == {}


def test_prepare_codegen_model_data_supports_from_remote_in_other_model(tmp_path):
    project_file = tmp_path / "test.project.yaml"
    project_file.write_text("runtime: { engine: { local_path: runtime } }\n")

    (tmp_path / "auditory.model.yaml").write_text("workloads: []\n")
    (tmp_path / "mind.model.yaml").write_text(
        """
remote_models:
  - name: auditory
    mode: IP
    connections:
      - from_remote: prosody.outputs.prosody_state.is_voiced
        to: voice_presence.inputs.is_present
"""
    )

    cfg = SimpleNamespace(
        model_name="auditory",
        project_file=project_file,
        model={"workloads": []},
    )

    workloads, connections, remote_models, telemetry = prepare_codegen_model_data(cfg)

    assert workloads == []
    assert connections == []
    assert telemetry == {}
    assert len(remote_models) == 1
    assert remote_models[0]["name"] == "mind"
    assert remote_models[0]["connections"] == [
        {
            "from": "prosody.outputs.prosody_state.is_voiced",
            "to_remote": "voice_presence.inputs.is_present",
            "var_name": (
                "mind_conn_prosody_outputs_prosody_state_is_voiced__to__"
                "voice_presence_inputs_is_present"
            ),
        }
    ]


def test_prepare_codegen_model_data_raises_on_duplicate_remote_connection_declarations(
    tmp_path,
):
    project_file = tmp_path / "test.project.yaml"
    project_file.write_text("runtime: { engine: { local_path: runtime } }\n")

    (tmp_path / "auditory.model.yaml").write_text(
        """
remote_models:
  - name: mind
    mode: IP
    connections:
      - from: prosody.outputs.prosody_state.is_voiced
        to_remote: voice_presence.inputs.is_present
"""
    )
    (tmp_path / "mind.model.yaml").write_text(
        """
remote_models:
  - name: auditory
    mode: IP
    connections:
      - from_remote: prosody.outputs.prosody_state.is_voiced
        to: voice_presence.inputs.is_present
"""
    )

    cfg = SimpleNamespace(
        model_name="auditory",
        project_file=project_file,
        model={"workloads": []},
    )

    with pytest.raises(ValueError, match="Duplicate remote connection declaration"):
        prepare_codegen_model_data(cfg)
