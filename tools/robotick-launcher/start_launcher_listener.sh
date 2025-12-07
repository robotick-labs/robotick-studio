#!/bin/bash
set -euo pipefail

trap 'status=$?; if [ $status -ne 0 ]; then echo "[launcher-listener] exited with code $status" >&2; fi' EXIT

if ! command -v robotick-launcher >/dev/null 2>&1; then
  echo "[launcher-listener] robotick-launcher executable not found on PATH." >&2
  exit 1
fi

echo "[launcher-listener] Starting robotick-launcher listen..."
if robotick-launcher listen; then
  echo "[launcher-listener] robotick-launcher terminated successfully."
else
  status=$?
  echo "[launcher-listener] robotick-launcher failed with exit code $status" >&2
  exit $status
fi
