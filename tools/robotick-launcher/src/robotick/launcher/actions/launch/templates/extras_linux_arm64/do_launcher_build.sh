#!/bin/bash
set -e

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
BUILD_DIR="$SCRIPT_DIR/build"

# Ensure cross-gcc configure is not polluted by host/container ambient flags
# (e.g. clang-only --gcc-toolchain injected via CFLAGS/CXXFLAGS).
unset CFLAGS
unset CXXFLAGS
unset CPPFLAGS
unset LDFLAGS

# The docker wrapper mounts the repo at the same absolute path as the host, so this build
# script can use ordinary in-tree CMake paths and still share its cache across rebuilds.
echo "📁 Configuring with CMake (linux arm64)..."
cmake \
  -S "$SCRIPT_DIR" \
  -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="" \
  -DCMAKE_CXX_FLAGS="" \
  -DCMAKE_EXE_LINKER_FLAGS="" \
  -DCMAKE_SHARED_LINKER_FLAGS="" \
  -DCMAKE_MODULE_LINKER_FLAGS="" \
  -DCMAKE_TOOLCHAIN_FILE="$SCRIPT_DIR/toolchain-linux-arm64.cmake"

echo "🔨 Building with CMake (linux arm64)..."
cmake --build "$BUILD_DIR" --parallel
