#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
. "$SCRIPT_DIR/do_launcher_common_setup.sh"

echo "🔌 Using ESP32 serial port: ${ESP32_SERIAL_PORT}"
echo "⚙️ Flashing and launching project inside docker..."
run_esp32_container device "
    set -e
    . /opt/esp/idf/export.sh

    if [[ -t 0 && -t 1 ]]; then
        echo -e \"\033[1m🔨 Flashing and launching project with monitor...\033[0m\" && \
        idf.py -p \"${ROBOTICK_ESP32_SERIAL_PORT}\" flash monitor
    else
        echo -e \"\033[1m🔨 Flashing project without monitor (no TTY attached)...\033[0m\" && \
        idf.py -p \"${ROBOTICK_ESP32_SERIAL_PORT}\" flash
    fi
"
