#!/usr/bin/env bash
set -euo pipefail

# Usage: ./test-dist-server.sh [port=8000] [host=localhost] [dir=dist]
PORT="${1:-8000}"
HOST="${2:-localhost}"
DIR="${3:-dist}"

PY=python3
command -v python3 >/dev/null 2>&1 || PY=python

if [ ! -d "$DIR" ]; then
  printf "Directory '%s' not found. Build the project first (e.g., npm run build).\n" "$DIR" >&2
  exit 1
fi

printf "\n\033[1mServing %s on http://%s:%s\033[0m\n\n" "$DIR" "$HOST" "$PORT"
"$PY" -m http.server "$PORT" --bind "$HOST" --directory "$DIR"