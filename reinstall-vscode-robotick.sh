#!/usr/bin/env bash
set -euo pipefail

EXT_DIR="tools/vscode-extension"

cd "$EXT_DIR"
npm run compile
npx @vscode/vsce package
VSIX="$(pwd)/robotick-0.1.2.vsix"

if command -v code >/dev/null 2>&1; then
  code --install-extension "$VSIX" --force
else
  echo "code CLI not found; please install VSIX manually: $VSIX"
fi
