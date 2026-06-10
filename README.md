# robotick-studio

Robotick Studio is the Electron shell and supporting services that wrap the `robotick-hub` web IDE so it can run as a full desktop experience. The same `robotick-hub` renderer lives under `src/renderer` and is both hosted as a web IDE and embedded inside Robotick Studio.

## Layers in this repo

- **`robotick-hub`** (renderer): Vite + React web IDE UI with telemetry viewers, editors, and the launcher experience.
- **`robotick-studio`** (Electron + native services): Electron main/preload, local launcher/telemetry services, and helpers that provide the native shell, configuration storage, and project plumbing.

## Quick scripts

- `npm run dev` / `npm run build` / `npm run preview` — work with the renderer web IDE directly.
- `npm run build:electron` / `npm run electron` — compile the Electron code and start Robotick Studio.
- `npm run test` — runs both renderer and Electron vitest suites.

## Studio document model

- Project-backed durable Studio state lives in `robots/<project>/studio/studio.yaml`.
- Electron main owns that canonical document and session coordination; renderer windows operate through the shared bridge rather than owning separate project documents.
- `workspace` still means the checkout/runtime/root concept; `workbench` means a Studio UI surface such as `remote-control` or `telemetry`.
- See [docs/studio-document.md](./docs/studio-document.md) for the ownership boundary and what intentionally remains runtime/session-only state.

## Current CLI inspection surface

The workspace `robotick` CLI now exposes Studio structure as navigable contexts. Once bound to a Studio instance, use:

- `ls` to discover child contexts
- `cd` to enter a child context
- `status` to inspect the currently bound node

The currently exposed path is:

```text
studio/<instance>/windows/<window>/workbenches/<workbench>/layouts/<layout>/panels/<panel>
```

See [docs/design/26-06-05 - robotick_cli_and_agentic_ux.md](./docs/design/26-06-05%20-%20robotick_cli_and_agentic_ux.md) for the canonical CLI, hub, launcher, and Studio control design.

This is structural inspection only. Panel/viewer readiness, recovery, and deeper diagnosability remain separate follow-on work.
