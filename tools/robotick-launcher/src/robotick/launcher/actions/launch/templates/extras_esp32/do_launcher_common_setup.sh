#!/bin/bash
set -e

echo "🧪 Host sanity check..."

# 🧠 SSH agent setup
if [ -z "$SSH_AUTH_SOCK" ]; then
    echo "🛑 SSH_AUTH_SOCK not set. Starting agent..."
    eval "$(ssh-agent -s)"
    ssh-add ~/.ssh/id_ed25519
fi

if [ ! -S "$SSH_AUTH_SOCK" ]; then
    echo "🛑 SSH agent socket not found at: $SSH_AUTH_SOCK"
    exit 1
fi

# 🐳 Container setup
if docker ps --format '{{.Names}}' | grep -q "^robotick-dev-esp32s3$"; then
    echo "✅ Container 'robotick-dev-esp32s3' already running."
else
    if docker ps -a --format '{{.Names}}' | grep -q "^robotick-dev-esp32s3$"; then
        echo "▶️  Starting existing container..."
        docker start robotick-dev-esp32s3
    else
        echo "🐳 Creating new container..."
        docker run -dit \
            --user root \
            --privileged \
            -v /dev:/dev \
            -v "$HOME/dev/robotick:/workspace" \
            -v "$HOME/.robotick-vscode-server":/root/.vscode-server \
            -v "$SSH_AUTH_SOCK:/ssh-agent" \
            -e SSH_AUTH_SOCK=/ssh-agent \
            -w /workspace/robotick-knitware/robots/barr-e/.launcher/barr_e/barr_e_spine/esp32 \
            --name robotick-dev-esp32s3 \
            espressif/idf:release-v5.4 \
            bash
    fi
fi

# 📦 Install ninja if needed
if ! docker exec robotick-dev-esp32s3 which ninja > /dev/null 2>&1; then
    echo "📦 Installing ninja inside container..."
    docker exec robotick-dev-esp32s3 bash -c "apt-get update && apt-get install -y ninja-build"
else
    echo "✅ Ninja already installed."
fi
