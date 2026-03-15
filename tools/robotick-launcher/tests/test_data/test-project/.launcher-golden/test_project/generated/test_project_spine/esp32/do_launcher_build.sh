#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
. "$SCRIPT_DIR/do_launcher_common_setup.sh"

echo "⚙️  Building project inside docker..."
run_esp32_container build "
    set -e

    TARGET=esp32s3
    CACHE_FILE=build/CMakeCache.txt
    CURRENT_TARGET=
    if [[ -f \"\$CACHE_FILE\" ]]; then
        CURRENT_TARGET=\$(sed -n \"s/^IDF_TARGET:STRING=//p\" \"\$CACHE_FILE\" | head -n 1)
    fi

    if [[ ! -d build || \"\$CURRENT_TARGET\" != \"\$TARGET\" ]]; then
        echo -e \"\033[1m🔨 Configuring target \$TARGET...\033[0m\"
        idf.py set-target \"\$TARGET\"
    else
        echo -e \"\033[1m♻️  Reusing existing build directory for \$TARGET...\033[0m\"
    fi

    echo -e \"\033[1m🔨 Building project...\033[0m\"
    idf.py build
"
