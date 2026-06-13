# robotick-studio

Robotick Studio is the desktop app and supporting services that wrap the `robotick-hub` web IDE so it can run as a full desktop experience. The same `robotick-hub` renderer lives under `src/renderer` and is both hosted as a web IDE and embedded inside Robotick Studio.

## Layers in this repo

- **`robotick-hub`** (renderer): Vite + React web IDE UI with telemetry viewers, editors, and the launcher experience.
- **`robotick-studio`** (desktop app + native services): Electron main/preload, local launcher/telemetry services, and helpers that provide the native shell, configuration storage, and project plumbing.

## Quick scripts

- `npm run dev` / `npm run build` / `npm run preview` — work with the renderer web IDE directly.
- `npm run build:studio` / `npm run studio` — compile the Studio desktop runtime and start Robotick Studio.
- `npm run studio-dev` — start the hub-managed Studio dev wrapper.
- `npm run dev:studio` — run the Vite renderer and Studio desktop runtime together for the primary hot-reload workflow.
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

Known resource commands can be chained after launch:

```bash
robotick studio open pip-e windows main workbenches terminal activate
```

See [docs/design/26-06-05 - robotick_cli_and_agentic_ux.md](./docs/design/26-06-05%20-%20robotick_cli_and_agentic_ux.md) for the canonical CLI, hub, launcher, and Studio control design.

This is structural inspection only. Panel/viewer readiness, recovery, and deeper diagnosability remain separate follow-on work.

## Studio diagnostics

The current read-only diagnostics surface is available through the workspace `robotick` CLI:

```bash
./tools/robotick studio <instance> diagnostics status
./tools/robotick studio <instance> diagnostics endpoints
./tools/robotick studio <instance> diagnostics renderer
./tools/robotick studio <instance> diagnostics fetch-check
./tools/robotick studio <instance> diagnostics telemetry
./tools/robotick studio <instance> diagnostics console
./tools/robotick studio <instance> diagnostics dom summary
./tools/robotick studio <instance> diagnostics dom query '[data-project-picker]'
./tools/robotick studio <instance> diagnostics css query '[data-project-picker]'
./tools/robotick studio <instance> diagnostics screenshot
./tools/robotick studio <instance> diagnostics snapshot
```

Use these when Studio is open but the UI appears stale, telemetry is missing, or launcher-facing state does not match what the renderer is showing.

- `status` reports live project identity and current focus/workbench state
- `endpoints` compares startup, current, and workspace hub endpoints
- `renderer` returns the renderer-published snapshot plus bounded renderer errors
- `console` returns bounded Studio-owned console/error records
- `fetch-check` reports active HTTP checks for launcher/project/terminal dependencies plus renderer-observed websocket failures
- `telemetry` reports per-model runtime health, renderer telemetry state, websocket state, and last sample/error details
- `dom summary` and `dom query` inspect the live renderer DOM with input values redacted by default
- `css query` reports computed styles, layout boxes, and stylesheet load visibility
- `screenshot` captures the active window with dimensions, route/resource metadata, and basic validation signals
- `snapshot` aggregates the main diagnostics slices into one bounded result

When `snapshot` sees Remote Control active but no telemetry model health, the CLI adds a `cli_hints` entry that distinguishes "Studio is open to Remote Control" from "the robot runtime is launched and ready."

Screenshot files are written under the workspace root at `.robotick/diagnostics/`. A successful screenshot only proves that the active Studio window was captured; operator workflows should also verify the active workbench, launcher readiness, and renderer telemetry state before treating the image as semantically correct. Use `--resource-path`, `--wait-for-render`, and `--wait-for-telemetry` when the capture should activate a view and wait briefly before capture.

The current diagnostics surface works in both dev and production Studio builds.

The intended source of truth for console diagnostics is a Studio-owned diagnostics/logging pipeline rather than DevTools history. Renderer Chromium console events, main-process warnings, renderer-published diagnostics, and future plugin diagnostics should feed bounded structured buffers that the CLI and future MCP surfaces can query consistently in both dev and production.

The in-app log viewer should use target logs rather than separate panels for each log family. The existing `Terminal` surface should keep that visible name for MVP while growing target selection for `runtime` and `studio`, defaulting to both, with each row labelled by source so launcher/model logs and Studio diagnostics remain distinguishable.

Production-build examples:

```bash
./tools/robotick studio instances
./tools/robotick studio <instance> diagnostics status
./tools/robotick studio <instance> diagnostics endpoints
./tools/robotick studio <instance> diagnostics renderer
./tools/robotick studio <instance> diagnostics telemetry
```

These are intended to replace the old habit of opening DevTools just to confirm project identity, hub endpoint wiring, renderer snapshot state, or telemetry subscriptions.

## Ownership split

Current ownership is intentionally split like this:

- hub owns bootstrap and lifecycle concerns: project discovery, Studio open/create, tracked instances, control-endpoint registration, quit, and unavailable-provider handling
- Studio main owns live Studio behavior: resource tree, focused state, activation, project selection, and diagnostics
- renderer publishes view-local state upward for diagnostics, but it is not the authority for process, window, or resource truth
- diagnostics history should be Studio-owned and queryable without DevTools: Electron main should broker the shared diagnostics/logging pipeline, while renderer and plugin surfaces publish into it as structured events
- the visible `Terminal` UI should become a target-log viewer over separate sources, not separate duplicated panels for runtime and Studio logs

The current CLI spelling is still mostly hard-coded, but live Studio status and diagnostics now come from the Studio control endpoint rather than hub-synthesized fallback state. The long-term direction is a Studio-owned command registry in main with hub acting as a thin bootstrap and forwarding layer.
