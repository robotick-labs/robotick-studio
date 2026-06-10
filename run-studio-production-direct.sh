#!/usr/bin/env bash

set -euo pipefail

unset ELECTRON_RUN_AS_NODE
unset ELECTRON_NO_ATTACH_CONSOLE

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STUDIO_DIR="$SCRIPT_DIR"
WORKSPACE_ROOT="${ROBOTICK_WORKSPACE_ROOT:-}"

if [[ -z "$WORKSPACE_ROOT" ]]; then
  echo "[run-studio-production-direct] ROBOTICK_WORKSPACE_ROOT is required." >&2
  exit 1
fi

WORKSPACE_ROOT="$(cd "$WORKSPACE_ROOT" && pwd)"
cd "$WORKSPACE_ROOT"
export ROBOTICK_STUDIO_INSTANCE_NAME="${ROBOTICK_STUDIO_INSTANCE_NAME:-studio-$$}"

# Production launch should build the packaged renderer/runtime, not rerun the
# full Studio verification suite on every start.
ROBOTICK_WORKSPACE_ROOT="$WORKSPACE_ROOT" npm --prefix "$STUDIO_DIR" run build
ROBOTICK_WORKSPACE_ROOT="$WORKSPACE_ROOT" npm --prefix "$STUDIO_DIR" run electron:direct
