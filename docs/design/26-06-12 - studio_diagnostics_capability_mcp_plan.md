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

`studio diagnostics fetch-check <target>` should ask the renderer to perform the same request the UI uses and report:

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
- Support production builds. Do not depend on Vite HMR or DevTools being open.
- Redact sensitive values by default. Redact input values, tokens, auth headers, environment secrets, and query params with sensitive names.
- Keep payloads bounded. Large DOM/CSS responses should be truncated with explicit truncation metadata.

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

Hub-owned Studio responsibilities:

- list registered workspace projects before any Studio process exists
- open/create Studio instances
- list known live Studio instances from instance records
- register and validate Studio control endpoints
- quit or recover Studio instances, including stale process cleanup
- aggregate Studio-published capabilities into hub capability discovery
- aggregate Studio plugin-published capabilities and resources without knowing each plugin's internal command model
- report provider availability when an instance is missing, stale, or lacks a control endpoint

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
