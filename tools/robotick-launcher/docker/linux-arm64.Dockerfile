# Cross-build image for Pi-targeted linux/arm64 models.
# Debian Bookworm is a close runtime match for Raspberry Pi OS Bookworm while still
# being straightforward to reproduce in local Docker and GitHub Actions.
FROM debian:bookworm

ENV DEBIAN_FRONTEND=noninteractive

# Install the arm64 cross-toolchain plus the arm64 dev packages the generated linux
# launcher targets currently link against (SDL2, OpenCV, yaml-cpp, png, zlib).
RUN dpkg --add-architecture arm64 \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        cmake \
        crossbuild-essential-arm64 \
        file \
        git \
        ninja-build \
        pkg-config \
        python3 \
        libopencv-dev:arm64 \
        libsdl2-dev:arm64 \
        libsdl2-gfx-dev:arm64 \
        libsdl2-ttf-dev:arm64 \
        libyaml-cpp-dev:arm64 \
        zlib1g-dev:arm64 \
        libpng-dev:arm64 \
    && rm -rf /var/lib/apt/lists/*

# Launcher scripts provide the command; the image just supplies a stable toolchain/sysroot.
CMD ["bash"]
