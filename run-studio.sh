#!/usr/bin/env bash

set -euo pipefail

# Ensure Electron actually launches the desktop runtime rather than Node fallback.
unset ELECTRON_RUN_AS_NODE
unset ELECTRON_NO_ATTACH_CONSOLE

# Keep the renderer bundle in sync before launching electron.
npm run build

# Launch the built Electron experience so the studio shell starts with the renderer.
npm run electron
