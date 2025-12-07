#!/bin/bash
set -e

# Resolve launcher_dir to the folder this script is in
SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
BUILD_DIR="$SCRIPT_DIR/build"

echo "📁 Configuring with CMake..."
cmake -S "$SCRIPT_DIR" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release

echo "🔨 Building with CMake..."
cmake --build "$BUILD_DIR" --parallel
