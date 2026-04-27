# Dependency Audit (2025-12-11)

This document captures the current native/wasm surface area of the Robotick Studio app and the pinned C++ dependencies exercised by the launcher workloads. Re-run the commands below whenever npm dependencies or workload specs change so OSS contributors know exactly which binaries ship with the project.

## Electron/Node runtime surface

Commands:

```bash
cd robotick-studio
find node_modules -name "*.node"
find node_modules -name "*.wasm"
```

Findings (2025-12-11):

| Category | Module | Notes |
| --- | --- | --- |
| Native `.node` | `@rollup/rollup-linux-x64-gnu`, `@rollup/rollup-linux-x64-musl` | Prebuilt rollup binaries used by Vite during development/build. Not loaded at runtime inside the renderer, but keep them pinned via package-lock. |
| WebAssembly | `cesium` / `@cesium/*` | Cesium bundles Draco, Basis, wasm-splats, and zip wasm modules under `Build/` and `Source/ThirdParty`. |
| WebAssembly | `three` examples, `draco3d`, `@dimforge/rapier3d-compat`, `@zip.js/zip.js` | Pulled in via npm for Three.js helpers (draco, basis, ammo, rhino3dm) and physics/image tooling. |

No additional `.node` modules or custom wasm blobs exist beyond the third-party libs listed above.

## Launcher workload dependencies

Primary workload specs live under `tools/robotick-launcher/tests/test_data/robotick/robotick-core-workloads`. Relevant pinning:

| Workload | File | Dependency | Details |
| --- | --- | --- | --- |
| MuJoCo (linux) | `simulation/MuJoCoWorkload.yaml` | MuJoCo SDK | Uses `git_source_archive` pinned to `https://github.com/google-deepmind/mujoco/releases/download/3.1.5/mujoco-3.1.5-linux-x86_64.tar.gz`, extracted under `deps/mujoco`. |
| MuJoCo (linux) | `simulation/MuJoCoWorkload.yaml` | yaml-cpp | Git dep pinned to `yaml-cpp-0.7.0`, built from source under `deps/yaml-cpp`. |
| Face/Heartbeat Display (linux) | `ui/FaceDisplayWorkload.yaml`, `ui/HeartbeatDisplayWorkload.yaml` | SDL2, SDL2_gfx, SDL2_ttf, OpenCV | All provided via apt/pkg-config with explicit minimum versions (`libsdl2-dev >= 2.0.14`). |
| Face/Heartbeat Display (esp32) | Same files | `M5GFX`, `M5Unified` | Git deps pinned to commits `e1bf27b` and `bf322a0`. |

Document any new deps directly inside the workload YAML (pin, source type, extraction path) so Launcher builds remain reproducible.
