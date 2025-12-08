#!/bin/bash
set -e

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
. "$SCRIPT_DIR/do_launcher_common_setup.sh"

echo "⚙️ Flashing and launching project inside docker..."
docker exec -it robotick-dev-esp32s3 bash -c "
    set -e
    . /opt/esp/idf/export.sh

    echo -e \"\033[1m🔨 Flashing and launching project...\033[0m\" && \
    idf.py -p /dev/ttyACM1 flash monitor
"
