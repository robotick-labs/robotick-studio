#!/usr/bin/env bash
set -euo pipefail

# Robotick Studio installer
# Fetches the robotick-studio repo at the requested ref, runs npm ci + build,
# configures Electron sandbox if possible, and installs into the given target
# path with a simple launcher in bin/robotick-studio and a .studio-version file.

REPO_URL="https://github.com/robotick-labs/robotick-studio.git"

version=""
target=""
project_dir=""
checksum=""

usage() {
  cat <<EOF
Usage: $0 --version <tag-or-sha> --target <path> [--project <path>] [--checksum <sha256>]

Options:
  --version    Required. Git tag or commit SHA to install.
  --target     Required. Install directory for Studio (will be replaced).
  --project    Optional. Project directory (passed through for future use).
  --checksum   Optional. Expected sha256 of this installer script (informational).
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[install] Missing dependency: $1" >&2
    exit 1
  }
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      version="$2"; shift 2 ;;
    --target)
      target="$2"; shift 2 ;;
    --project)
      project_dir="$2"; shift 2 ;;
    --checksum)
      checksum="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "[install] Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$version" || -z "$target" ]]; then
  usage
  exit 1
fi

# Informational checksum notice if provided.
if [[ -n "$checksum" ]]; then
  echo "[install] Note: checksum provided ($checksum) but not verified in this script." >&2
fi

require_cmd git
require_cmd npm
require_cmd node

target_parent="$(dirname "$target")"
mkdir -p "$target_parent"
target="$(cd "$target_parent" && pwd)/$(basename "$target")"
project_dir="${project_dir:-$target}"

workdir="$(mktemp -d)"
cleanup() {
  rm -rf "$workdir"
}
trap cleanup EXIT

echo "[install] Installing robotick-studio@$version to $target"

src_dir="$workdir/src"
echo "[install] Fetching source..."
git clone --no-checkout "$REPO_URL" "$src_dir" >/dev/null 2>&1
git -C "$src_dir" fetch --depth 1 origin "$version" >/dev/null
git -C "$src_dir" checkout FETCH_HEAD >/dev/null

resolved_sha="$(git -C "$src_dir" rev-parse HEAD)"
echo "[install] Resolved to $resolved_sha"

echo "[install] Installing npm deps (npm ci)..."
(cd "$src_dir" && npm ci >/dev/null)

echo "[install] Building renderer bundle..."
(cd "$src_dir" && npm run build >/dev/null)

echo "[install] Building electron main process..."
(cd "$src_dir" && npm run build:electron >/dev/null)

version_file="$src_dir/.studio-version"
cat >"$version_file" <<EOF
ref=$version
resolved=$resolved_sha
EOF

bin_dir="$src_dir/bin"
mkdir -p "$bin_dir"
cat >"$bin_dir/robotick-studio" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
TOOLKIT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$TOOLKIT/node_modules/.bin/electron" "$TOOLKIT" "$@"
EOF
chmod +x "$bin_dir/robotick-studio"

configure_sandbox() {
  local sandbox="$1"
  if [[ ! -f "$sandbox" ]]; then
    return
  fi
  local owner mode
  if [[ "$(uname -s 2>/dev/null)" == "Darwin" ]]; then
    owner="$(stat -f '%u' "$sandbox" 2>/dev/null || echo "")"
    mode="$(stat -f '%OLp' "$sandbox" 2>/dev/null || echo "")"
  else
    owner="$(stat -c '%u' "$sandbox" 2>/dev/null || echo "")"
    mode="$(stat -c '%a' "$sandbox" 2>/dev/null || echo "")"
  fi
  if [[ "$owner" == "0" && "$mode" == "4755" ]]; then
    return
  fi
  echo "[install] Configuring Electron sandbox permissions..."
  if chown root:root "$sandbox" 2>/dev/null && chmod 4755 "$sandbox" 2>/dev/null; then
    echo "[install] Sandbox permissions applied."
    return
  fi
  if command -v sudo >/dev/null 2>&1; then
    if sudo chown root:root "$sandbox" && sudo chmod 4755 "$sandbox"; then
      echo "[install] Sandbox permissions applied via sudo."
      return
    fi
  fi
  echo "[install] Warning: unable to set chrome-sandbox permissions automatically." >&2
  echo "[install] Please run: sudo chown root:root '$sandbox' && sudo chmod 4755 '$sandbox'" >&2
}

configure_sandbox "$src_dir/node_modules/electron/dist/chrome-sandbox"

echo "[install] Replacing target at $target"
rm -rf "$target"
mv "$src_dir" "$target"

echo "[install] Done. Binary: $target/bin/robotick-studio"
