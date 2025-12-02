#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/.studio/.venv"
PYTHON="${PYTHON:-python3}"

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  PYTHON="python"
fi

if [ ! -d "$VENV" ]; then
  "$PYTHON" -m venv "$VENV"
fi

# shellcheck source=/dev/null
source "$VENV/bin/activate"

pip install --upgrade pip >/dev/null
pip install -e "$ROOT/tools/robotick-launcher[dev]" >/dev/null

cd "$ROOT/tools/robotick-launcher"

echo "=== Running launcher tests ==="
set +e
pytest -vv tests "$@"
EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
  echo "=== Launcher tests PASSED ==="
else
  echo "=== Launcher tests FAILED (exit code $EXIT_CODE) ==="
fi
exit $EXIT_CODE
