#!/usr/bin/env bash

set -euo pipefail

unset ELECTRON_RUN_AS_NODE
unset ELECTRON_NO_ATTACH_CONSOLE

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKING_DIR="$(dirname "$SCRIPT_DIR")"
STUDIO_DIR="$SCRIPT_DIR"
LAUNCHER_KILL="$STUDIO_DIR/tools/robotick-launcher/kill_launcher_listener.sh"

if [ -x "$LAUNCHER_KILL" ]; then
  "$LAUNCHER_KILL"
fi

cd "$WORKING_DIR"

# Production launch should build the packaged renderer/runtime, not rerun the
# full Studio verification suite on every start.
ROBOTICK_WORKSPACE_ROOT="$WORKING_DIR" npm --prefix "$STUDIO_DIR" run build
ROBOTICK_WORKSPACE_ROOT="$WORKING_DIR" npm --prefix "$STUDIO_DIR" run electron
