#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ "${ROBOTICK_STUDIO_MANAGED_BY_HUB:-}" != "1" ]]; then
  echo "[run-studio-production] Robotick Studio must be launched via robotick-hub/CLI." >&2
  echo "[run-studio-production] Use: robotick studio open [project]" >&2
  exit 1
fi

exec "$SCRIPT_DIR/run-studio-production-direct.sh" "$@"
