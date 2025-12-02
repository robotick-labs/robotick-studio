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
pip install -e "$ROOT/tools/robotick-launcher" >/dev/null

cd "$ROOT/tools/robotick-launcher"
pytest tests "$@"
