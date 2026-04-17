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

IMAGE_NAME="ghcr.io/robotick-labs/robotick-idf5.4-esp32:latest"
CONTAINER_HOME="/tmp/robotick-home"
CONTAINER_CACHE_HOME="$CONTAINER_HOME/.cache"
ESP32_SERIAL_PORT="${ROBOTICK_ESP32_SERIAL_PORT:-/dev/ttyACM1}"
ESP32_TARGET_VARIANT="${ROBOTICK_ESP32_TARGET_VARIANT:-}"
IDF_EXTRA_CMAKE_ARGS_VALUE="${IDF_EXTRA_CMAKE_ARGS:-}"
ROBOTICK_PLATFORM_ESP32S3_M5_VALUE="${ROBOTICK_PLATFORM_ESP32S3_M5:-}"

ensure_esp32_image() {
    if [[ "$IMAGE_NAME" == *":latest" ]]; then
        echo "🐳 Refreshing ESP32 image: $IMAGE_NAME"
    elif docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
        return
    else
        echo "🐳 Pulling ESP32 image: $IMAGE_NAME"
    fi

    if [[ "${ROBOTICK_LAUNCHER_DRY_RUN:-0}" == "1" ]]; then
        return
    fi
    docker pull "$IMAGE_NAME"
}

container_name_for_mode() {
    local mode="$1"
    local scope_hash
    scope_hash="$(printf '%s' "$IMAGE_NAME|$REPO_ROOT|$mode" | sha256sum | awk '{print substr($1, 1, 12)}')"
    echo "robotick-launcher-esp32-${mode}-${scope_hash}"
}

ensure_esp32_container() {
    local mode="$1"
    local container_name="$2"
    local image_id
    local container_image_id
    local container_state

    ensure_esp32_image

    image_id="$(docker image inspect -f '{{.Id}}' "$IMAGE_NAME" 2>/dev/null || true)"
    container_image_id="$(docker container inspect -f '{{.Image}}' "$container_name" 2>/dev/null || true)"

    if [[ -n "$container_image_id" && -n "$image_id" && "$container_image_id" != "$image_id" ]]; then
        echo "\$ docker rm -f $container_name"
        if [[ "${ROBOTICK_LAUNCHER_DRY_RUN:-0}" != "1" ]]; then
            docker rm -f "$container_name" >/dev/null
        fi
        container_image_id=""
    fi

    if [[ -z "$container_image_id" ]]; then
        local -a create_cmd=(
            docker create
            --name "$container_name"
            --init
            -v "$REPO_ROOT:$REPO_ROOT"
            -w "$REPO_ROOT"
        )

        if [[ "$mode" == "device" ]]; then
            create_cmd+=(
                --privileged
                -v /dev:/dev
            )
        fi

        create_cmd+=("$IMAGE_NAME" sleep infinity)

        echo "\$ ${create_cmd[*]}"
        if [[ "${ROBOTICK_LAUNCHER_DRY_RUN:-0}" != "1" ]]; then
            "${create_cmd[@]}" >/dev/null
        fi
    fi

    container_state="$(docker container inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null || true)"
    if [[ "$container_state" != "running" ]]; then
        echo "\$ docker start $container_name"
        if [[ "${ROBOTICK_LAUNCHER_DRY_RUN:-0}" != "1" ]]; then
            docker start "$container_name" >/dev/null
        fi
    fi
}

run_esp32_container() {
    local mode="$1"
    shift

    local container_name
    container_name="$(container_name_for_mode "$mode")"
    ensure_esp32_container "$mode" "$container_name"
    local wrapped_command="mkdir -p \"$CONTAINER_CACHE_HOME\" && . /opt/esp/idf/export.sh >/dev/null && $*"

    local -a cmd=(
        docker exec
    )

    if [[ "$mode" == "device" ]]; then
        if [[ -t 0 && -t 1 ]]; then
            cmd+=(-it)
        fi
        cmd+=(
            -w "$SCRIPT_DIR"
            -e "HOME=$CONTAINER_HOME"
            -e "XDG_CACHE_HOME=$CONTAINER_CACHE_HOME"
            -e "ROBOTICK_ESP32_SERIAL_PORT=$ESP32_SERIAL_PORT"
            -e "ROBOTICK_PLATFORM_ESP32S3_M5=$ROBOTICK_PLATFORM_ESP32S3_M5_VALUE"
            -e "IDF_EXTRA_CMAKE_ARGS=$IDF_EXTRA_CMAKE_ARGS_VALUE"
        )
    else
        # Build-only mode does not need device access and can run as the calling user, which
        # keeps generated files writable on the host and works cleanly in CI.
        cmd+=(
            --user "$(id -u):$(id -g)"
            -w "$SCRIPT_DIR"
            -e "HOME=$CONTAINER_HOME"
            -e "XDG_CACHE_HOME=$CONTAINER_CACHE_HOME"
            -e "ROBOTICK_PLATFORM_ESP32S3_M5=$ROBOTICK_PLATFORM_ESP32S3_M5_VALUE"
            -e "IDF_EXTRA_CMAKE_ARGS=$IDF_EXTRA_CMAKE_ARGS_VALUE"
        )
    fi

    cmd+=("$container_name" bash -lc "$wrapped_command")

    echo "\$ ${cmd[*]}"
    if [[ "${ROBOTICK_LAUNCHER_DRY_RUN:-0}" == "1" ]]; then
        return
    fi

    "${cmd[@]}"
}
