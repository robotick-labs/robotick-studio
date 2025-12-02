#!/usr/bin/env bash

set -euo pipefail

unset ELECTRON_RUN_AS_NODE
unset ELECTRON_NO_ATTACH_CONSOLE

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STUDIO_DIR="$SCRIPT_DIR"

npm --prefix "$STUDIO_DIR" run test
npm --prefix "$STUDIO_DIR" run build
npm --prefix "$STUDIO_DIR" run electron
