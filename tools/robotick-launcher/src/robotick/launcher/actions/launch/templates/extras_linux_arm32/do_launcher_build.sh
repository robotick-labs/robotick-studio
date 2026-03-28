#!/bin/bash
set -e

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
BUILD_DIR="$SCRIPT_DIR/build"

echo "📁 Configuring with CMake (linux arm32)..."
cmake \
  -S "$SCRIPT_DIR" \
  -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE="$SCRIPT_DIR/toolchain-linux-arm32.cmake"

echo "🔨 Building with CMake (linux arm32)..."
cmake --build "$BUILD_DIR" --parallel
