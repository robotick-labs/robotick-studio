#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
. "$SCRIPT_DIR/do_launcher_common_setup.sh"

echo "🔌 Using ESP32 serial port: ${ESP32_SERIAL_PORT}"
echo "⚙️ Flashing and launching project inside docker..."
run_esp32_container device "
    set -e

    FLASH_STATE_FILE=\"$SCRIPT_DIR/.last_flashed_image.sha256\"
    HOST_UID=\$(stat -c %u \"$SCRIPT_DIR\")
    HOST_GID=\$(stat -c %g \"$SCRIPT_DIR\")
    APP_BIN=\$(find build -maxdepth 1 -type f -name '*.bin' ! -name 'ota_data_initial.bin' | head -n 1)

    if [[ -z \"\$APP_BIN\" ]]; then
        echo \"🛑 Unable to locate application binary in \$SCRIPT_DIR/build\" >&2
        exit 1
    fi

    compute_flash_bundle_checksum() {
        sha256sum \
            \"\$APP_BIN\" \
            build/flash_args \
            build/bootloader/bootloader.bin \
            build/partition_table/partition-table.bin \
            build/ota_data_initial.bin | sha256sum | awk '{print \$1}'
    }

    record_last_flash_checksum() {
        printf '%s\n' \"\$1\" > \"\$FLASH_STATE_FILE\"
        chown \"\$HOST_UID:\$HOST_GID\" \"\$FLASH_STATE_FILE\"
    }

    reset_into_app() {
        echo -e \"\033[1m♻️  Rebooting device into the flashed app...\033[0m\"
        esptool.py \
            --chip esp32s3 \
            -p \"${ROBOTICK_ESP32_SERIAL_PORT}\" \
            --before default_reset \
            --after hard_reset \
            run
    }

    CURRENT_FLASH_CHECKSUM=\$(compute_flash_bundle_checksum)
    LAST_FLASH_CHECKSUM=
    if [[ -f \"\$FLASH_STATE_FILE\" ]]; then
        LAST_FLASH_CHECKSUM=\$(tr -d '[:space:]' < \"\$FLASH_STATE_FILE\")
    fi

    if [[ \"\$CURRENT_FLASH_CHECKSUM\" != \"\$LAST_FLASH_CHECKSUM\" ]]; then
        echo -e \"\033[1m🔨 Flashing updated project image...\033[0m\"
        idf.py -p \"${ROBOTICK_ESP32_SERIAL_PORT}\" flash
        record_last_flash_checksum \"\$CURRENT_FLASH_CHECKSUM\"
    else
        echo -e \"\033[1m📝 Flash skipped; image checksum unchanged.\033[0m\"
        reset_into_app
    fi

    if [[ -t 0 && -t 1 ]]; then
        echo -e \"\033[1m📟 Attaching serial monitor...\033[0m\"
        idf.py -p \"${ROBOTICK_ESP32_SERIAL_PORT}\" monitor
    fi
"
