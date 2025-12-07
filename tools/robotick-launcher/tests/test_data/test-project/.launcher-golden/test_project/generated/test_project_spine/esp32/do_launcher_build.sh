#!/bin/bash
set -e

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
. "$SCRIPT_DIR/do_launcher_common_setup.sh"

echo "⚙️  Building project inside docker..."
docker exec robotick-dev-esp32s3 bash -c "
    set -e
    . /opt/esp/idf/export.sh

    echo -e \"\033[1m🔨 Setting target...\033[0m\"
    idf.py set-target esp32s3

    echo -e \"\033[1m🔨 Building project...\033[0m\"
    idf.py build
"
