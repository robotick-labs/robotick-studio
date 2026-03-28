#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
. "$SCRIPT_DIR/do_launcher_common_setup.sh"

echo "⚙️  Building project inside docker..."
run_esp32_container build "
    set -e

    TARGET=esp32s3
    CACHE_FILE=build/CMakeCache.txt
    SDKCONFIG_DEFAULTS_FILE=sdkconfig.defaults
    SDKCONFIG_STATE_FILE=.last_sdkconfig_defaults.sha256
    CURRENT_TARGET=
    CURRENT_SDKCONFIG_DEFAULTS_CHECKSUM=
    LAST_SDKCONFIG_DEFAULTS_CHECKSUM=

    if [[ -f \"\$SDKCONFIG_DEFAULTS_FILE\" ]]; then
        CURRENT_SDKCONFIG_DEFAULTS_CHECKSUM=\$(sha256sum \"\$SDKCONFIG_DEFAULTS_FILE\" | awk '{print \$1}')
    fi
    if [[ -f \"\$SDKCONFIG_STATE_FILE\" ]]; then
        LAST_SDKCONFIG_DEFAULTS_CHECKSUM=\$(tr -d '[:space:]' < \"\$SDKCONFIG_STATE_FILE\")
    fi

    if [[ -n \"\$CURRENT_SDKCONFIG_DEFAULTS_CHECKSUM\" && \"\$CURRENT_SDKCONFIG_DEFAULTS_CHECKSUM\" != \"\$LAST_SDKCONFIG_DEFAULTS_CHECKSUM\" ]]; then
        echo -e \"\033[1m🧹 Detected sdkconfig.defaults change; resetting ESP-IDF build state...\033[0m\"
        rm -rf build sdkconfig sdkconfig.old
    fi

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

    if [[ -n \"\$CURRENT_SDKCONFIG_DEFAULTS_CHECKSUM\" ]]; then
        printf '%s\n' \"\$CURRENT_SDKCONFIG_DEFAULTS_CHECKSUM\" > \"\$SDKCONFIG_STATE_FILE\"
    fi
"
