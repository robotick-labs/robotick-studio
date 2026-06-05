#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="${HOME}/.local/bin"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bin-dir)
      if [[ $# -lt 2 ]]; then
        echo "[install-robotick-cli] --bin-dir requires a value" >&2
        exit 1
      fi
      BIN_DIR="$2"
      shift 2
      ;;
    --help|-h)
      cat <<'EOF'
Usage: install-robotick-cli.sh [--bin-dir <dir>]

Installs a small `robotick` shim onto PATH. The shim finds the nearest
workspace containing `robotick.yaml` and delegates to its local
`./tools/robotick` bootstrap command.
EOF
      exit 0
      ;;
    *)
      echo "[install-robotick-cli] Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$BIN_DIR"
TARGET="$BIN_DIR/robotick"

cat >"$TARGET" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

find_workspace_root() {
  local dir
  if [[ -n "${ROBOTICK_WORKSPACE_ROOT:-}" ]]; then
    dir="$ROBOTICK_WORKSPACE_ROOT"
  else
    dir="$(pwd)"
  fi

  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/robotick.yaml" && -x "$dir/tools/robotick" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  return 1
}

WORKSPACE_ROOT="$(find_workspace_root)" || {
  echo "[robotick] Could not find a Robotick workspace from $(pwd)" >&2
  exit 1
}

export ROBOTICK_WORKSPACE_ROOT="$WORKSPACE_ROOT"
exec "$WORKSPACE_ROOT/tools/robotick" "$@"
EOF

chmod +x "$TARGET"
echo "Installed robotick shim at $TARGET"
