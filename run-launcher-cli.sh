#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <launcher-command> [args...]" >&2
  echo "Example: $0 build pip-e pip-e-brain linux --base-dir robotick_local/robotick-knitware" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(pwd)"
VENV_DIR="$WORKSPACE_ROOT/.studio/.venv"
PYTHON_BIN="${PYTHON:-python3}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"

# Cache pip installs so we only upgrade when deps change
MARKER_DIR="$WORKSPACE_ROOT/.studio"
MARKER_FILE="$MARKER_DIR/.launcher_pip_installed"
DEPENDENCY_FILES=(
  "$SCRIPT_DIR/tools/robotick-launcher/pyproject.toml"
  "$SCRIPT_DIR/tools/robotick-launcher/setup.cfg"
  "$SCRIPT_DIR/tools/robotick-launcher/poetry.lock"
)
mkdir -p "$MARKER_DIR"

needs_install=false
if [ ! -f "$MARKER_FILE" ]; then
  needs_install=true
else
  for dep in "${DEPENDENCY_FILES[@]}"; do
    if [ -f "$dep" ] && [ "$dep" -nt "$MARKER_FILE" ]; then
      needs_install=true
      break
    fi
  done
fi

if [ "$needs_install" = true ]; then
  echo "[Launcher CLI] Installing/updating launcher dependencies..."
  LAUNCHER_PATH="$SCRIPT_DIR/tools/robotick-launcher"
  LAUNCHER_URI="$("$PYTHON_BIN" - <<'PY' "$LAUNCHER_PATH"
import pathlib, sys
print(pathlib.Path(sys.argv[1]).resolve().as_uri())
PY
)"
  LAUNCHER_SPEC="robotick-launcher[dev] @ ${LAUNCHER_URI}"
  if ! pip install --upgrade pip >/dev/null || \
     ! pip install -e "$LAUNCHER_SPEC" >/dev/null; then
    rm -f "$MARKER_FILE"
    echo "[Launcher CLI] Pip install failed; please rerun." >&2
    exit 1
  fi
  touch "$MARKER_FILE"
fi

LAUNCHER_BIN="$VENV_DIR/bin/robotick-launcher"
COMMAND="$1"
shift
ARGS=("$@")

base_dir_present=false
for ((i=0; i<${#ARGS[@]}; i++)); do
  arg="${ARGS[$i]}"
  if [[ "$arg" == --base-dir=* ]]; then
    base_dir_present=true
    break
  fi
  if [[ "$arg" == "--base-dir" ]]; then
    base_dir_present=true
    break
  fi
  if [[ "$arg" == "-b" ]]; then
    base_dir_present=true
    break
  fi

done

if [ "$base_dir_present" = false ]; then
  ARGS+=("--base-dir" "$WORKSPACE_ROOT")
fi

echo "[Launcher CLI] Running: $LAUNCHER_BIN $COMMAND ${ARGS[*]}"
"$LAUNCHER_BIN" "$COMMAND" "${ARGS[@]}"
