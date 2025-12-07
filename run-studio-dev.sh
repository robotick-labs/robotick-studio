#!/usr/bin/env bash

set -euo pipefail

unset ELECTRON_RUN_AS_NODE
unset ELECTRON_NO_ATTACH_CONSOLE

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKING_DIR="$(dirname "$SCRIPT_DIR")"
STUDIO_DIR="$SCRIPT_DIR"

cd "$WORKING_DIR"
ROBOTICK_WORKSPACE_ROOT="$WORKING_DIR" npm --prefix "$STUDIO_DIR" run dev:all
