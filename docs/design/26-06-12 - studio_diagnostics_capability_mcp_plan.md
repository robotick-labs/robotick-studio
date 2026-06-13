# Studio Diagnostics, Capability Discovery, And MCP Alignment Plan

Date: 2026-06-12

Status: Proposed architecture

Related docs:

- `docs/design/26-06-05 - robotick_cli_and_agentic_ux.md`
- `docs/design/26-06-11 - launcher_ability_model_session_groups_tdd.md`
- `docs/agent-recipes.md`

## Goal

Add a read-only `studio diagnostics` context under the Robotick CLI and hub so agents can inspect a live Studio instance, renderer state, browser console output, DOM/CSS state, hub endpoint wiring, launcher runtime projection, and telemetry subscriptions without tailing logs or guessing from process state.

The immediate failure mode this should make obvious is:

- Studio was launched with an old `ROBOTICK_HUB_ENDPOINT`.
- The current hub record points at a newer hub.
- CLI/curl can reach the current hub, but the renderer still fetches or opens websockets against stale state.
- The UI displays a machine project id or project file basename instead of the project file's human-readable `name`.

## Proposed CLI Shape

```bash
./tools/robotick studio <instance> diagnostics status
./tools/robotick studio <instance> diagnostics endpoints
./tools/robotick studio <instance> diagnostics renderer
./tools/robotick studio <instance> diagnostics console --tail 200 --level warn,error
./tools/robotick studio <instance> diagnostics fetch-check launcher-runtime
./tools/robotick studio <instance> diagnostics telemetry
./tools/robotick studio <instance> diagnostics dom summary
./tools/robotick studio <instance> diagnostics dom query '<selector>'
./tools/robotick studio <instance> diagnostics css query '<selector>'
./tools/robotick studio <instance> diagnostics screenshot --window main
./tools/robotick studio <instance> diagnostics snapshot --format json
```

Also add a simple capability discovery surface with sensible defaults for agents:

```bash
./tools/robotick capabilities
./tools/robotick capabilities --json
```

`capabilities` should show everything discoverable from the current workspace, hub, and live providers right now. It should avoid "drip-feeding" only the next context-specific actions, but it should not pretend to be globally complete forever. Some capabilities are static CLI commands; others are workspace-derived, hub-derived, or live-instance-derived.

Default text output should be compact and useful. JSON output should be stable enough for agents and future MCP adapters.

The CLI should be a convenient local surface over the same capability/resource registry that a future MCP server would expose. Avoid baking agent-only semantics into the CLI that would need to be re-modeled later for MCP.

## Diagnostics Data Model

`studio diagnostics status` should return:

- instance id, pid, process state, mode, started time
- selected project id, project path, project directory, project file `name`, hub display name, and UI-rendered project label
- active window, focused window, active workbench, active layout, active panel when available
- diagnostics capability versions and limits

`studio diagnostics endpoints` should return:

- renderer startup hub endpoint from preload environment
- current hub endpoint from main-process bridge
- `.robotick/hub.json` endpoint and pid
- hub health response and feature list
- stale endpoint warnings when any endpoint disagrees
- Vite/dev server origin or production renderer origin
- websocket endpoint URLs used by terminal and telemetry

`studio diagnostics renderer` should return a renderer-published state snapshot:

- current project path in ProjectContext
- project picker selected value and rendered label
- launcher API base/cached endpoint
- latest launcher status fetch state and last error
- loaded workbench/editor ids
- active telemetry source and subscriptions
- active viewer state, including selected stream/source and last frame time

`studio diagnostics console` should return structured Chromium console records:

- timestamp
- window scope
- level
- message
- source URL
- line and column
- optional stack or structured payload when available

The intended implementation is not "query DevTools history". Studio should own a bounded diagnostics log pipeline and expose filtered snapshots from that pipeline. Chromium console events from renderer windows should be captured through `webContents` events and normalized into the same event stream as main-process diagnostics, renderer-published errors, fetch failures, websocket failures, and future plugin diagnostics.

`studio diagnostics fetch-check <target>` should report the same dependency path the UI uses. For the MVP, HTTP probes run from Electron main using renderer-published URLs, while browser-only CORS evidence and websocket state come from renderer-published failure records. A later renderer-executed probe can be added where exact browser fetch semantics matter. Each check should report:

- effective URL
- method
- origin
- status when available
- response headers relevant to CORS
- error name/message
- whether the failure looks like stale endpoint, CORS, DNS, refused connection, timeout, or non-OK HTTP

Initial targets:

- `launcher-runtime`
- `project-settings`
- `project-list`
- `terminal-log-snapshot`
- `terminal-log-stream`
- `telemetry-health:<model-id>`
- `telemetry-ws:<model-id>`

`studio diagnostics telemetry` should return, for the selected project:

- configured models and telemetry base URLs
- hub-side health results
- renderer-side health/fetch results
- active websocket subscriptions
- last frame/sample time
- ingress and presentation rates when known
- last telemetry error per model/source

`studio diagnostics dom` should expose browser-side inspection without DevTools:

- `summary`: title, URL, active route, visible workbench root, focused element, selected project control text
- `query <selector>`: matching count, text content, attributes, bounding rect, visibility, disabled state, aria label/name, and selected value for form controls
- output must be size bounded and redact input values by default

Electron main should own these diagnostics commands and route browser-context inspection through a bounded renderer script execution bridge. Renderer code should not grow ad hoc diagnostics endpoints; it should execute the Electron-owned command and return bounded, redacted results.

`studio diagnostics css query <selector>` should return:

- computed key styles for matching elements
- loaded stylesheet URLs
- failed stylesheet loads if known
- layout/bounding box and overflow information

`studio diagnostics screenshot` should capture:

- active window by default
- named window scope when provided
- optional selector/element capture later
- output path in `.robotick/diagnostics/`
- capture metadata: dimensions, active window/workbench/layout, route URL, generated timestamp, and capture source
- validation metadata useful to agents: nonblank result, optional expected workbench/resource match, and basic content bounds

The CLI should route screenshot capture through `studio <instance> diagnostics screenshot`; agents should not need to copy a raw control endpoint from `studio open`. Operator-facing screenshot flows should optionally combine resource activation, launcher readiness, renderer telemetry readiness, and screenshot capture so a valid image is also semantically the requested view. For example, "capture Barr.e in Remote Control" should distinguish "Studio opened Remote Control" from "Barr.e runtime is launched and visible in Remote Control".

`studio diagnostics snapshot` should aggregate:

- status
- endpoints
- renderer state
- last console warnings/errors
- last failed fetches/websockets
- launcher runtime projection
- telemetry diagnostics
- DOM summary
- screenshot path when `--include-screenshot` is passed

## Hub And Studio Architecture

- Keep diagnostics read-only by default.
- Implement a Studio control-service diagnostics route per instance.
- Use the Electron main process as the authority for process/window/control state.
- Use preload IPC for renderer diagnostics requests.
- Let renderer modules register diagnostic providers with a small registry, for example `window.robotick.diagnostics.registerProvider("launcher", provider)`.
- Keep a bounded in-memory ring buffer for console records, fetch failures, websocket failures, and renderer errors.
- Prefer a shared diagnostics/logging pipeline over isolated buffers. Different producers should publish structured events into one Studio-owned sink, with diagnostics routes exposing bounded per-window, per-source, and aggregate views over that sink.
- Support production builds. Do not depend on Vite HMR or DevTools being open.
- Redact sensitive values by default. Redact input values, tokens, auth headers, environment secrets, and query params with sensitive names.
- Keep payloads bounded. Large DOM/CSS responses should be truncated with explicit truncation metadata.

Diagnostics/logging pipeline shape:

- Canonical event schema with timestamp, severity, source, window scope, message, and optional structured payload.
- Producers:
  - Electron main diagnostics and warnings
  - renderer Chromium console events captured via `webContents`
  - renderer-published app diagnostics and errors
  - fetch/websocket failure capture
  - future plugin diagnostics providers
- Views:
  - per-window console ring buffers
  - per-source filtered slices such as `renderer:<window>` or `plugin:<id>`
  - bounded aggregate snapshots for CLI/MCP resources
  - an in-Studio target-log viewer that can show runtime logs, Studio diagnostics logs, or both
- DevTools is a secondary human debugging surface only. It is not the authoritative store for agent-facing diagnostics history.

## Target Logs Panel

MVP should avoid adding a separate Studio Log panel alongside Terminal. Instead, evolve the existing Terminal viewer into a target-log viewer while retaining the visible `Terminal` name.

Initial targets:

- `runtime`: launcher/model/runtime logs, preserving the current Terminal behavior
- `studio`: Studio diagnostics/logging pipeline events, including main-process diagnostics, renderer Chromium console records, renderer-published diagnostics/errors, fetch failures, and websocket failures

The panel should default to both targets enabled. A checkbox/dropdown target selector should let users show `runtime`, `studio`, or both. When both are enabled, each row must clearly carry source/target metadata so runtime output and Studio diagnostics are not collapsed into an undifferentiated stream. The visible panel title should remain `Terminal` for MVP to preserve existing project documents and user expectations.

This keeps the visible tool count low while preserving data-model separation:

- runtime/launcher logs remain runtime data
- Studio diagnostics logs remain Studio-owned diagnostic data
- plugins can later add new targets such as `plugin:<id>` without a new panel type

## Studio Command Publication State

Current behavior:

- Studio ability routes are hard-coded in the hub ability.
- CLI Studio actions are hard-coded in the CLI command router and help registry.
- Studio instances already publish live resource state through the Electron control endpoint: windows, workbenches, layouts, panels, active/focused state, and selected project path.
- Hub already proxies several live-instance routes to that control endpoint when it is registered.
- Studio instances do not yet publish a structured action/capability list for those resources.

Target behavior:

- Make the hub-hosted Studio ability thin.
- Keep hard-coded hub-side Studio routes only for bootstrapping, discovery, and lifecycle.
- Let Studio publish resource-local capabilities/actions, such as `activate`, `status`, `diagnostics`, `select-project`, and future panel-specific actions.
- Let Studio plugins publish their own resources, actions, diagnostics, and future MCP endpoints through the same Studio-owned registry.
- Attach capability metadata directly to resource nodes, alongside existing `children`, `active`, `activatable`, and `activation_target_path` fields.
- Let hub aggregate static CLI capabilities, workspace capabilities, hub abilities, launcher capabilities, live Studio instance capabilities, and Studio plugin capabilities.
- Keep resource identifiers URI-shaped where practical, so live Studio state can become MCP resources without inventing a second naming system.

## Studio Command System Target

The end state should not just be "more diagnostics routes". Studio should grow a proper command/capability system with Electron as the authoritative broker, so future in-Studio commands, plugin actions, and MCP mapping all sit on the same foundation.

Core architectural patterns:

- Keep command identity, metadata, availability, and dispatch in Electron main.
- Let renderer participate only where browser context is genuinely required, such as DOM/CSS inspection, view-local state capture, or renderer-owned editor behavior.
- Treat preload as a typed transport bridge, not as a place to accumulate business logic or command routing.
- Keep hub thin: bootstrap, lifecycle, provider availability, and aggregation. Hub should not become the true command registry for live Studio behavior.

Command registry requirements:

- Register commands with stable ids, not just route strings.
- Include metadata for title, description, provider, resource scope, input schema, output schema, read-only/mutating/destructive flags, and availability.
- Support core Studio commands and plugin-published commands through the same registry.
- Allow commands to declare whether they are Electron-owned or renderer-assisted.
- Keep command ids and resource URIs stable even if CLI spelling changes.

Renderer participation rules:

- Renderer-owned state should be published upward as snapshots, diagnostics records, and focused/active UI hints.
- Renderer should not become the canonical source of process/window/resource truth.
- Renderer-assisted commands should execute through Electron-owned command definitions, with Electron validating inputs and returning the final shaped response.
- DOM/CSS/query/screenshot-style features may require renderer or webContents execution, but they should still be surfaced through Electron-owned command metadata.

Plugin publication rules:

- Plugins should publish commands, resources, and diagnostics through Studio-owned registration APIs.
- Plugin registration should mirror the general shape already used for editor/plugin discovery, but command execution should still route through Electron-owned command definitions.
- Hub should aggregate plugin-published capabilities and resources without plugin-specific route code.
- Plugin contributions should carry plugin id and namespace so ids remain stable and collision-free.

This is the comparison line with Blender/Maya/UE5-style systems: explicit command/operator registration, explicit availability/context rules, and a clean separation between command metadata, command dispatch, and UI/editor implementation details.

Example resource-published action shape:

```json
{
  "uri": "studio://studio-1312460/workbenches/remote-control",
  "resource_type": "studio_workbench",
  "id": "remote-control",
  "label": "Remote Control",
  "actions": [
    {
      "id": "studio.resource.activate",
      "label": "Activate",
      "tool_name": "studio_resource_activate",
      "read_only": false,
      "destructive": false,
      "input_schema": {
        "type": "object",
        "required": ["resource_uri"],
        "properties": {
          "resource_uri": {
            "type": "string"
          }
        }
      },
      "path": ["windows", "main", "workbenches", "remote-control", "activate"]
    }
  ]
}
```

## Thin Studio Ability Target

The hub-hosted Studio ability should become a thin bootstrap and proxy layer. Studio itself should own the bulky behavior because it has the authoritative process/window/renderer state, makes hub less brittle, and gives Studio plugins a natural place to publish their own commands, diagnostics, resources, and future MCP endpoints.

Current route inventory and classification:

Hub-hosted Studio routes:

- `GET /v1/studio/projects` -> bootstrap/discovery
- `GET /v1/studio/instances` -> bootstrap/discovery
- `POST /v1/studio/open` -> bootstrap/lifecycle
- `POST /v1/studio/instances/{instance_id}/quit` -> lifecycle/recovery
- `POST /v1/studio/instances/{instance_id}/control-endpoint` -> provider registration
- `GET /v1/studio/instances/{instance_id}/status` -> live Studio-owned capability, forwarded
- `GET /v1/studio/instances/{instance_id}/focused` -> live Studio-owned capability, forwarded
- `GET /v1/studio/instances/{instance_id}/diagnostics/{kind}` -> live Studio-owned capability, forwarded
- `POST /v1/studio/instances/{instance_id}/project/select` -> live Studio-owned capability, forwarded
- `POST /v1/studio/instances/{instance_id}/activate`
- `POST /v1/studio/instances/{instance_id}/{resource_path}/activate` -> live Studio-owned capability, forwarded
- `GET /v1/studio/instances/{instance_id}/{resource_path}/status` -> live Studio-owned capability, forwarded
- `POST /v1/apps/studio/instances/closing` -> lifecycle/recovery

Electron control-service routes:

- `GET /v1/focused` and `GET /v1/studio/focused` -> live Studio-owned capability
- `GET /v1/status` and `GET /v1/studio/status` -> live Studio-owned capability
- `GET /v1/studio/{resource_path}/status` -> live Studio-owned capability
- `POST /v1/activate` and `POST /v1/studio/activate` -> live Studio-owned capability
- `POST /v1/studio/{resource_path}/activate` -> live Studio-owned capability
- `POST /v1/project/select` -> live Studio-owned capability
- `GET /v1/diagnostics/status` -> live Studio-owned capability
- `GET /v1/diagnostics/endpoints` -> live Studio-owned capability
- `GET /v1/diagnostics/renderer` -> live Studio-owned capability
- `GET /v1/diagnostics/fetch-check` -> live Studio-owned capability
- `GET /v1/diagnostics/telemetry` -> live Studio-owned capability

This is the current intended line:

- hub owns bootstrap/discovery/lifecycle/provider-availability behavior
- Electron control service owns live Studio state and command execution
- renderer assists only where browser context is required

Hub-owned Studio responsibilities:

- list registered workspace projects before any Studio process exists
- open/create Studio instances
- list known live Studio instances from instance records
- register and validate Studio control endpoints
- quit or recover Studio instances, including stale process cleanup
- aggregate Studio-published capabilities into hub capability discovery
- aggregate Studio plugin-published capabilities and resources without knowing each plugin's internal command model
- report provider availability when an instance is missing, stale, or lacks a control endpoint

Minimal hub-owned Studio ability contract:

- registered workspace projects
- known Studio instances from instance records
- Studio open/create
- Studio quit/recovery
- Studio control-endpoint registration and validation
- provider availability and structured `provider_unavailable` responses
- forwarding of current useful live Studio commands until higher-level capability discovery is in place

Studio-owned capabilities:

- resource tree and resource-local actions: status, activate, focused, select-project
- diagnostics: status, endpoints, renderer, console, fetch-check, telemetry, DOM, CSS, screenshot, snapshot
- renderer state and project display-name truth
- distinct project identity fields: machine id/project id, selected project path, project directory, project file `name`, and UI-rendered display label
- workbench/panel/editor/plugin-specific actions, resources, diagnostics, and MCP endpoint metadata
- MCP-style resources and tools for live Studio internals, with the CLI consuming the same metadata

Migration principles:

- Do not make opening Studio depend on Studio-published capabilities; bootstrapping remains hub-owned.
- Prefer simplifying or replacing old internal surfaces over preserving backwards-compatible shims.
- Keep temporary shims only when they materially reduce migration risk, and remove them in the same phase.
- Promote existing Electron control-service routes as the canonical live provider surface instead of duplicating their behavior in hub.
- Introduce a real Studio-owned command registry in Electron before expanding the command surface much further.
- Migrate existing live operations such as `status`, `focused`, `activate`, `select-project`, and `diagnostics:*` onto that registry instead of leaving them as unrelated route special cases.
- Prefer proxying to the Studio control endpoint when an instance is live.
- Keep plugin-specific behavior behind Studio-owned provider registration; hub should not need plugin-specific route code.
- Return explicit unavailable-provider diagnostics when Studio is not live or has no control endpoint.
- Keep user-facing CLI spelling stable only when it remains useful; internal API compatibility is not a goal.

Example ownership split:

```text
hub.studio.open                         hub-owned bootstrap action
hub.studio.instances                    hub-owned instance registry query
hub.studio.quit                         hub-owned lifecycle/recovery action
studio.<instance>.resource.status       Studio-owned live provider action
studio.<instance>.resource.activate     Studio-owned live provider action
studio.<instance>.diagnostics.snapshot  Studio-owned live provider action/resource
```

Current implementation status:

- live Studio `status`, `focused`, `activate`, `select-project`, and diagnostics routes now treat the Electron control service as the canonical provider surface
- hub no longer synthesizes fallback live Studio resource state for those routes when a live instance lacks a control endpoint
- when a Studio instance exists but the live provider is unavailable, hub returns structured `provider_unavailable` results instead of silently falling back to config-derived state

MCP-shaped ownership mapping:

```text
robotick://workspace/projects                         hub-owned resource
robotick://hub/instances                              hub-owned resource
studio://{instance}/resources                         Studio-owned resource tree
studio://{instance}/diagnostics/snapshot              Studio-owned resource
studio://{instance}/diagnostics/console               Studio-owned resource
studio://{instance}/telemetry/{model_id}/health       Studio-owned resource template
studio://{instance}/plugins/{plugin_id}/resources     Studio plugin-owned resource tree
studio_resource_activate                              Studio-owned tool
studio_project_select                                 Studio-owned tool
studio_diagnostics_fetch_check                        Studio-owned read-only tool
studio_plugin_tool                                    Studio plugin-owned tool template
```

Proposed command layering:

```text
CLI path / hub proxy
  -> hub bootstrap or live Studio forwarding
  -> Electron command registry
  -> core Electron handler or renderer-assisted handler
  -> Studio-owned response/resource payload
```

This layering keeps command registration tidy inside Studio, keeps hub less brittle, and gives plugins a clear place to publish future commands and MCP-shaped endpoints.

## Chromium And Renderer Capture Requirements

Capture these even in production builds:

- `webContents` console messages
- renderer `window.onerror`
- renderer `unhandledrejection`
- failed dynamic imports
- failed fetches and websocket connections from app-owned wrappers
- active DOM summary
- selector-level DOM and computed-style inspection
- current-window screenshot via Electron `capturePage`

## Capability Discovery Requirements

`capabilities` should be useful for humans, agents, and future MCP adapters:

- print the discoverable command/capability tree for the current runtime context
- support JSON output with stable machine-readable command ids
- include command side-effect classification: read-only, starts service, opens app, mutates runtime, stops runtime
- include output shape hints: JSON, text, stream, websocket-backed, file path
- include common aliases and shorthand
- include availability requirements, such as "requires live Studio instance" or "requires hub"
- include provider/source metadata: static CLI, workspace, hub, launcher, Studio instance, plugin
- include input schema and output schema where practical
- include MCP mapping fields where practical: resource URI, resource template URI, tool name, tool annotations, and provider endpoint
- avoid hidden/experimental complexity initially; add visibility metadata later if needed

## MCP Alignment Requirements

Robotick does not need to become MCP-first immediately, but the capability model should make an MCP adapter mostly mechanical.

- Treat inspectable state as resources, not commands: workspace projects, hub instances, Studio resource trees, diagnostics snapshots, console buffers, telemetry health, launcher runtime state, and screenshots.
- Treat actions as tools: open Studio, quit Studio, activate Studio resource, select project, run fetch-check, capture screenshot, and request a bounded diagnostics snapshot.
- Prefer URI-shaped resource ids from the start, for example `robotick://workspace/projects`, `robotick://hub/instances`, and `studio://{instance}/diagnostics/snapshot`.
- Use JSON Schema-compatible input and output schemas for every capability that might become an MCP tool.
- Include MCP-style read-only/destructive/idempotent/open-world hints in capability metadata where they are knowable.
- Keep tool names stable, snake_case, and independent of CLI spelling.
- Keep CLI paths as human-oriented aliases over tool ids and resource URIs.
- Make resources self-describing enough that an MCP client can discover useful next actions from resource metadata.
- Add resource templates for parameterized state such as `studio://{instance}/diagnostics/dom?selector={selector}` and `studio://{instance}/telemetry/{model_id}/health`.
- Let Studio plugins contribute resource templates and tool definitions with namespaced ids, for example `studio.plugin.anim_editor.timeline.snapshot`.
- Include provider freshness and availability fields so an MCP client can distinguish "resource absent" from "provider currently unavailable".
- Prefer bounded snapshots and paged/tail-able resources over unbounded log dumps.
- Keep screenshots and other binary outputs as file/path resources first; add binary MCP transport later if needed.
- Do not model transient UI commands as durable resources unless they expose inspectable state.
- Do not require hub changes for new Studio plugins or plugin-local MCP surfaces.
- Do not make future MCP depend on shelling out to the CLI; the MCP adapter should call the same hub/provider registry the CLI uses.
