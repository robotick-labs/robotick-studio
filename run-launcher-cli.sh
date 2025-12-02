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
pip install --upgrade pip >/dev/null
pip install -e "$SCRIPT_DIR/tools/robotick-launcher[dev]" >/dev/null

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
  if [[ "$arg" =~ ^- && "$arg" != "-" ]]; then
    continue
  fi

done

if [ "$base_dir_present" = false ]; then
  ARGS+=("--base-dir" "$WORKSPACE_ROOT")
fi

echo "[Launcher CLI] Running: $LAUNCHER_BIN $COMMAND ${ARGS[*]}"
"$LAUNCHER_BIN" "$COMMAND" "${ARGS[@]}"
