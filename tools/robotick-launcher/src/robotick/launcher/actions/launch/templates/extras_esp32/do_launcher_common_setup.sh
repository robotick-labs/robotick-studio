#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
LAUNCHER_ENV_FILE="$SCRIPT_DIR/launcher.env"

if [[ -z "$REPO_ROOT" ]]; then
    echo "🛑 Unable to determine git repo root from $SCRIPT_DIR"
    exit 1
fi

if [[ -f "$LAUNCHER_ENV_FILE" ]]; then
    # Generated launcher env values come from model metadata, for example the configured
    # USB serial port for a specific ESP32 board.
    # shellcheck disable=SC1090
    . "$LAUNCHER_ENV_FILE"
fi

IMAGE_NAME="robotick-launcher-esp32s3"
DOCKERFILE="$REPO_ROOT/robotick/robotick-studio/tools/robotick-launcher/docker/esp32s3.Dockerfile"
DOCKERFILE_SHA_LABEL="robotick.dockerfile_sha"
ESP32_SERIAL_PORT="${ROBOTICK_ESP32_SERIAL_PORT:-/dev/ttyACM1}"
ESP32_TARGET_VARIANT="${ROBOTICK_ESP32_TARGET_VARIANT:-}"
IDF_EXTRA_CMAKE_ARGS_VALUE="${IDF_EXTRA_CMAKE_ARGS:-}"
ROBOTICK_PLATFORM_ESP32S3_M5_VALUE="${ROBOTICK_PLATFORM_ESP32S3_M5:-}"

ensure_esp32_image() {
    local current_sha
    current_sha="$(sha256sum "$DOCKERFILE" | awk '{print $1}')"

    if docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
        local existing_sha
        existing_sha="$(docker image inspect -f "{{ index .Config.Labels \"$DOCKERFILE_SHA_LABEL\" }}" "$IMAGE_NAME" 2>/dev/null || true)"
        if [[ "$existing_sha" == "$current_sha" ]]; then
            return
        fi
    fi

    echo "🐳 Building ESP32-S3 image: $IMAGE_NAME"
    docker build \
        -t "$IMAGE_NAME" \
        --label "$DOCKERFILE_SHA_LABEL=$current_sha" \
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
            -e "ROBOTICK_PLATFORM_ESP32S3_M5=$ROBOTICK_PLATFORM_ESP32S3_M5_VALUE"
            -e "IDF_EXTRA_CMAKE_ARGS=$IDF_EXTRA_CMAKE_ARGS_VALUE"
        )
    else
        # Build-only mode does not need device access and can run as the calling user, which
        # keeps generated files writable on the host and works cleanly in CI.
        cmd+=(
            --user "$(id -u):$(id -g)"
            -e "ROBOTICK_PLATFORM_ESP32S3_M5=$ROBOTICK_PLATFORM_ESP32S3_M5_VALUE"
            -e "IDF_EXTRA_CMAKE_ARGS=$IDF_EXTRA_CMAKE_ARGS_VALUE"
        )
    fi

    cmd+=("$IMAGE_NAME" bash -lc "$*")

    echo "\$ ${cmd[*]}"
    if [[ "${ROBOTICK_LAUNCHER_DRY_RUN:-0}" == "1" ]]; then
        return
    fi

    "${cmd[@]}"
}
