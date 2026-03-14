#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
. "$SCRIPT_DIR/do_launcher_common_setup.sh"

echo "⚙️  Running clean + set-target + build inside container..."
run_esp32_container build "
    set -e
    . /opt/esp/idf/export.sh

    echo '🧹 Cleaning build directory...'
    rm -rf build
    echo '🧹 Finished cleaning build directory'
"
