import shutil
import difflib
import re
from pathlib import Path
from typer.testing import CliRunner
import subprocess
import pytest

from robotick.launcher.cli import create_app

runner = CliRunner()
app = create_app()

TEST_BASE = Path("tests/test_data/test-project").resolve()
OUTPUT_DIR_BASE = TEST_BASE / ".launcher"
GOLDEN_DIR_BASE = TEST_BASE / ".launcher-golden"


def reset_output_dir(output_dir: Path):
    if output_dir.exists():
        shutil.rmtree(output_dir)


def normalize_lines(lines):
    return [line.strip() for line in lines if line.strip() != ""]


def normalize_workload_paths(text: str) -> str:
    """Replace absolute workload paths with a consistent placeholder."""
    pattern = re.compile(r"[^ \n\r\t]*tests/test_data/workloads")
    return pattern.sub("__WORKLOADS_ROOT__/tests/test_data/workloads", text)


def _list_files(dir_path: Path):
    if not dir_path.exists() or not dir_path.is_dir():
        pytest.fail(f"❌ Path is missing or not a directory: {dir_path}", pytrace=False)
    # Collect, filter to files, then sort deterministically
    all_paths = list(dir_path.rglob("*"))
    file_paths = [p for p in all_paths if p.is_file()]
    file_paths_rel = sorted((p.relative_to(dir_path) for p in file_paths), key=lambda p: str(p))
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
            pytrace=False
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
                diff = "".join(difflib.unified_diff(
                    gold_lines, out_lines,
                    fromfile=f"expected/{rel_path}",
                    tofile=f"actual/{rel_path}",
                    lineterm="\n"
                ))

                # Limit diff length for big files (optional)
                diff_lines = diff.splitlines()
                max_lines = 80
                if len(diff_lines) > max_lines:
                    diff = "\n".join(diff_lines[:max_lines]) + f"\n... (diff truncated, {len(diff_lines)} total lines)"

                pytest.fail(
                    f"\n📝 File content mismatch: {rel_path}\n\n{diff}",
                    pytrace=False
                )


@pytest.mark.parametrize("target,model", [
    ("linux", "test-project-brain"),
    ("esp32", "test-project-spine"),
])
def test_launcher_generate(target, model):
    
    output_subdir = Path("test_project") / model.replace("-", "_") / target.replace("-", "_")

    OUTPUT_DIR = OUTPUT_DIR_BASE / output_subdir
    GOLDEN_DIR = GOLDEN_DIR_BASE / output_subdir

    reset_output_dir(OUTPUT_DIR)

    cmd = [
        "robotick-launcher", "generate",
        "test-project", model, target,
        "--base-dir", str(TEST_BASE),
        "--stub-install"
    ]
    print(f"💻 Running subprocess: {' '.join(cmd)}")

    subprocess.run(cmd, check=True)

    assert_dirs_match(OUTPUT_DIR, GOLDEN_DIR)
