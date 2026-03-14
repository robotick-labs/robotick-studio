#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
. "$SCRIPT_DIR/do_launcher_common_setup.sh"

echo "⚙️  Building project inside docker..."
run_esp32_container build "
    set -e
    . /opt/esp/idf/export.sh

    echo -e \"\033[1m🧹 Cleaning build directory...\033[0m\"
    rm -rf build

    echo -e \"\033[1m🔨 Setting target...\033[0m\"
    idf.py set-target esp32s3

    echo -e \"\033[1m🔨 Building project...\033[0m\"
    idf.py build
"
