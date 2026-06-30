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

LAUNCHER_PATH="$ROOT/tools/robotick-launcher"
HUB_PATH="$ROOT/tools/robotick-hub"
LAUNCHER_URI="$("$PYTHON" - <<'PY' "$LAUNCHER_PATH"
import pathlib, sys
print(pathlib.Path(sys.argv[1]).resolve().as_uri())
PY
)"
HUB_URI="$("$PYTHON" - <<'PY' "$HUB_PATH"
import pathlib, sys
print(pathlib.Path(sys.argv[1]).resolve().as_uri())
PY
)"
LAUNCHER_SPEC="robotick-launcher[dev] @ ${LAUNCHER_URI}"
HUB_SPEC="robotick-hub[dev] @ ${HUB_URI}"

if [ "${ROBOTICK_SKIP_LAUNCHER_FIXTURE_SYNC:-0}" != "1" ]; then
  "$ROOT/tools/robotick-launcher/tests/sync-fixtures.sh"
fi

pip install --upgrade pip >/dev/null
pip install -e "$HUB_SPEC" >/dev/null
pip install -e "$LAUNCHER_SPEC" >/dev/null

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
