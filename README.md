# robotick-studio

Robotick Studio is the Electron shell and supporting services that wrap the `robotick-hub` web IDE so it can run as a full desktop experience. The same `robotick-hub` renderer lives under `src/renderer` and is both hosted as a web IDE and embedded inside Robotick Studio.

## Layers in this repo

- **`robotick-hub`** (renderer): Vite + React web IDE UI with telemetry viewers, editors, and the launcher experience.
- **`robotick-studio`** (Electron + native services): Electron main/preload, local launcher/telemetry services, and helpers that provide the native shell, configuration storage, and project plumbing.

## Quick scripts

- `npm run dev` / `npm run build` / `npm run preview` — work with the renderer web IDE directly.
- `npm run build:electron` / `npm run electron` — compile the Electron code and start Robotick Studio.
- `npm run test` — runs both renderer and Electron vitest suites.
