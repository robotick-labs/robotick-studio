# Reproducible ESP32-S3 build image for launcher-managed IDF builds.
# This stays intentionally thin on top of Espressif's official image and adds only the
# extra host tools the launcher scripts assume are present.
FROM espressif/idf:release-v5.4

USER root
ENV DEBIAN_FRONTEND=noninteractive

# Keep the image minimal: the IDF toolchain comes from the base image, and launcher
# build/run scripts provide the per-project commands.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        git \
        ninja-build \
    && rm -rf /var/lib/apt/lists/*

CMD ["bash"]
