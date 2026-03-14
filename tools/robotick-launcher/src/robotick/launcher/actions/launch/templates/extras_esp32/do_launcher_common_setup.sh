#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$REPO_ROOT" ]]; then
    echo "🛑 Unable to determine git repo root from $SCRIPT_DIR"
    exit 1
fi

IMAGE_NAME="robotick-launcher-esp32s3"
DOCKERFILE="$REPO_ROOT/robotick/robotick-studio/tools/robotick-launcher/docker/esp32s3.Dockerfile"
ESP32_SERIAL_PORT="${ROBOTICK_ESP32_SERIAL_PORT:-/dev/ttyACM1}"

ensure_esp32_image() {
    if docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
        return
    fi

    echo "🐳 Building ESP32-S3 image: $IMAGE_NAME"
    docker build \
        -t "$IMAGE_NAME" \
        -f "$DOCKERFILE" \
        "$REPO_ROOT"
}

run_esp32_container() {
    local mode="$1"
    shift

    ensure_esp32_image

    local -a cmd=(
        docker run
        --rm
        --init
        # Mirror the repo path inside the container so generated files and IDF build paths stay
        # stable across local runs and CI.
        -v "$REPO_ROOT:$REPO_ROOT"
        -w "$SCRIPT_DIR"
    )

    if [[ "$mode" == "device" ]]; then
        if [[ -t 0 && -t 1 ]]; then
            cmd+=(-it)
        fi
        cmd+=(
            --user root
            --privileged
            -v /dev:/dev
            -e "ROBOTICK_ESP32_SERIAL_PORT=$ESP32_SERIAL_PORT"
        )
    else
        # Build-only mode does not need device access and can run as the calling user, which
        # keeps generated files writable on the host and works cleanly in CI.
        cmd+=(--user "$(id -u):$(id -g)")
    fi

    cmd+=("$IMAGE_NAME" bash -lc "$*")

    echo "\$ ${cmd[*]}"
    "${cmd[@]}"
}
