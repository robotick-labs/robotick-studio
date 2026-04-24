#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
FIXTURES_ROOT="$ROOT/tools/robotick-launcher/tests/test_data/robotick"

ENGINE_URL="${ROBOTICK_LAUNCHER_FIXTURE_ENGINE_URL:-https://github.com/robotick-labs/robotick-engine.git}"
ENGINE_REF="${ROBOTICK_LAUNCHER_FIXTURE_ENGINE_REF:-c5daa0a2e0dbf1b37a873f664ee23f036baf056a}"
CORE_WORKLOADS_URL="${ROBOTICK_LAUNCHER_FIXTURE_CORE_WORKLOADS_URL:-https://github.com/robotick-labs/robotick-core-workloads.git}"
CORE_WORKLOADS_REF="${ROBOTICK_LAUNCHER_FIXTURE_CORE_WORKLOADS_REF:-0cb4347a3281ea2b3d00264b130e87d93230e26d}"

sync_repo() {
  local name="$1"
  local url="$2"
  local ref="$3"
  local dest="$4"

  if git -C "$dest" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "[sync-fixtures] Updating $name at $dest ($ref)"
    git -C "$dest" fetch --all --tags --prune
  elif [ -e "$dest" ]; then
    echo "[sync-fixtures] Refusing to overwrite non-git fixture path: $dest" >&2
    exit 1
  else
    echo "[sync-fixtures] Cloning $name into $dest ($ref)"
    git clone "$url" "$dest"
  fi

  if git -C "$dest" show-ref --verify --quiet "refs/remotes/origin/$ref"; then
    git -C "$dest" checkout -B "$ref" "origin/$ref"
  else
    git -C "$dest" checkout "$ref"
  fi
  git -C "$dest" submodule update --init --recursive
}

mkdir -p "$FIXTURES_ROOT"

sync_repo "robotick-engine" "$ENGINE_URL" "$ENGINE_REF" "$FIXTURES_ROOT/robotick-engine"
sync_repo "robotick-core-workloads" "$CORE_WORKLOADS_URL" "$CORE_WORKLOADS_REF" "$FIXTURES_ROOT/robotick-core-workloads"
