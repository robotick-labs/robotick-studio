#!/bin/bash
# -----------------------------------------------------------------------------
# Simple local web server for Robotick Telemetry UI (experimental version)
# -----------------------------------------------------------------------------
# Serves ./experimental on http://localhost:8000
# Uses Python 3’s built-in HTTP server.  Ctrl+C to stop.
# -----------------------------------------------------------------------------

PORT=1234
ROOT_DIR="$(dirname "$0")/experimental"

if [ ! -d "$ROOT_DIR" ]; then
  echo "❌ Directory not found: $ROOT_DIR"
  exit 1
fi

echo "📡 Starting local server for Robotick experimental UI..."
echo "    Serving from: $ROOT_DIR"
echo "    URL: http://localhost:${PORT}"
echo "Press Ctrl+C to stop."

cd "$ROOT_DIR" || exit 1
python3 -m http.server "${PORT}"
