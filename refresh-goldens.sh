#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}"
LAUNCHER_DIR="${REPO_ROOT}/tools/robotick-launcher"
PROJECT_DIR="${LAUNCHER_DIR}/tests/test_data/test-project"
GENERATED_DIR="${PROJECT_DIR}/.launcher/test_project/generated"
GOLDEN_DIR="${PROJECT_DIR}/.launcher-golden/test_project/generated"

# log prints a timestamped message to stdout, prefixing the provided arguments with the current HH:MM:SS time.
log() {
  echo "[$(date +'%H:%M:%S')] $*"
}

# rsync_target syncs a generated relative path from GENERATED_DIR into GOLDEN_DIR, creating the destination directory and skipping the sync if the source directory does not exist.
rsync_target() {
  local rel_path="$1"
  local src="${GENERATED_DIR}/${rel_path}"
  local dst="${GOLDEN_DIR}/${rel_path}"

  if [[ ! -d "${src}" ]]; then
    log "⚠️  Skipping ${rel_path} (missing: ${src})"
    return
  fi

  mkdir -p "${dst}"
  log "📁 Syncing ${rel_path}"
  rsync -a --delete "${src}/" "${dst}/"
}

log "🔄 Updating submodules (engine, core workloads, nested deps)..."
git -C "${REPO_ROOT}" submodule update --init --recursive

# run_launcher_tests runs the launcher test suite for the specified stage and logs whether the tests passed or failed.
run_launcher_tests() {
  local stage="$1"
  log "🧪 Running launcher tests (${stage})..."
  if (cd "${REPO_ROOT}" && npm run test:launcher >/dev/null 2>&1); then
    log "✅ Launcher tests passed (${stage})."
    return 0
  else
    log "⚠️  Launcher tests failed (${stage})."
    return 1
  fi
}

run_launcher_tests "pre-refresh" || log "Continuing despite failures (goldens may be stale)."

log "📦 Refreshing launcher goldens..."
rsync_target "test_project_brain/linux"
rsync_target "test_project_spine/esp32"

log "📝 Regenerating workloads_discovery golden..."
PYTHONPATH="${LAUNCHER_DIR}/src" \
python3 - <<'PY'
from pathlib import Path
from robotick.launcher.discover_workloads import discover_workloads_metadata_as_json

base_dir = Path("tools/robotick-launcher/tests")
cfg = type("Cfg", (), {})()
cfg.base_dir = base_dir.resolve()
cfg.runtime = {"workload_sources": [{"local_path": "test_data/robotick/robotick-core-workloads"}]}
cfg.target_platform = "linux"
cfg.dry_run = False
cfg.launcher_dir = cfg.base_dir / ".launcher"

discovered = discover_workloads_metadata_as_json(cfg) + "\n"
golden_dir = base_dir / "test_data"
golden_dir.mkdir(parents=True, exist_ok=True)
(golden_dir / "workloads_discovery.latest.json").write_text(discovered, encoding="utf-8")
(golden_dir / "workloads_discovery.golden.json").write_text(discovered, encoding="utf-8")
PY

log "✅ Goldens refreshed. Review changes with 'git status'."

if run_launcher_tests "post-refresh"; then
  log "🏁 Launcher tests green after refresh."
else
  log "❌ Launcher tests still failing; inspect diffs."
fi