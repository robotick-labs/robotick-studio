#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "${REPO_ROOT}" ]]; then
  echo "Failed to locate repository root" >&2
  exit 1
fi
"${REPO_ROOT}/refresh-goldens.sh" "$@"
