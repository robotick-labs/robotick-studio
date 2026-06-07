# Robotick Agentic Operations MVP

Date: 2026-06-05
Baseline project: `robots/barr-e`
Status: technical design for MVP implementation

## Executive Summary

Robotick Studio is already a powerful human workbench. It can open robot projects, launch runtime profiles, inspect models, show telemetry, drive viewports, and shape expressive behaviour. The gap is that much of its operational truth still lives in an operator's head: which project script to run, which window matters, which log line is bad, whether a blank viewport means "not ready yet" or "broken", and when it is safe to capture evidence or shut everything down.

This MVP makes those truths explicit. Studio instances, Studio windows, workbenches, layout tabs, panels, launcher services, launcher runs, viewer state, readiness classes, capture results, and shutdown blockers become named, typed, inspectable resources.

The immediate user-facing goal is a deterministic flow:

```text
open -> inspect -> launch -> wait -> recover if needed -> capture -> stop -> quit
```

The larger goal is agentic assist: a capable assistant should be able to understand Robotick's creative-technical workshop, operate its tools, notice what changed, explain what matters, and help the human creator steer the robot. The fact that this also makes the system clearer for humans, scripts, and tests is a valuable consequence, not the main reason for the work.

## Vision

Robotick is not just gaining a nicer command line. It is learning how to explain its own workshop so an assistant can help operate it.

The primary payoff is the assistant dynamic: the human keeps creative direction and judgment, while an agent helps handle the operational complexity of a live robotics workshop. Once Robotick exposes its workbench as a stable operational world, agents can operate tools, observe results, explain degraded states, compare runs, and help improve the system. They are not magic robot brains and they do not replace Robotick's runtime. They are capable workshop assistants, acting through explicit operational truth.

There is also a practical human payoff. A CLI can make daily bring-up less fiddly. A hub can stop stale services and duplicate launchers becoming mysterious. Tests can open Barr.e, wait for real readiness, capture the Remote Control view, save useful metadata, and close cleanly. A cold engineer, hobbyist, or future contributor can ask the system what exists instead of rummaging through scripts and guessing from UI state.

That unlocks workflows such as:

- bringing up Barr.e overnight, detecting that the face model crashed, capturing the exact degraded state, comparing it with yesterday's run, and leaving a concise report with the real failure boundary
- generating a new robot project skeleton, wiring declared workloads, running validation, opening Studio, inspecting missing telemetry, and pointing to the exact contract or connection that failed
- trying several versions of a curious head-turn, capturing each one, comparing timing curves and viewer output, and helping decide which behaviour reads most alive
- running expressive regression sweeps across saved scenarios and explaining whether motion now looks hesitant, abrupt, flat, or emotionally incoherent
- searching for personality bugs where face, posture, attention, and memory cues stop feeling like one being and start feeling like disconnected subsystems
- building small simulation scenes or scripted provocations to elicit surprise, caution, curiosity, frustration, or recovery, then comparing robot responses
- helping turn puppeteered discoveries into reusable behaviour by tracing the telemetry and state transitions behind a good live session
- maintaining historical run memory, with questions such as "when did Barr.e stop recovering cleanly from this state?" or "which change made this hesitation start reading as intentional instead of broken?"

The CLI matters because it is the first visible layer of that agent-readable operational truth. It is not a side quest into shell tooling. It is the first control surface for a Robotick workshop assistant: command the tools, inspect the state, recover the view, capture evidence, and help the human decide what to do next.

## Baseline Experiment

The baseline task was deliberately simple:

1. launch Studio
2. launch Barr.e
3. capture the main Remote Control viewport
4. stop Barr.e cleanly
5. exit Studio cleanly

The task completed mechanically, but the path was fragile. The first run captured a black Remote Control viewport even though the UI had moved past its placeholder state. A later run produced a better visual result. That variation showed that current readiness and visual-success signals are not explicit enough.

### Current Entry Points

Current human usage is based on repo scripts and the Studio UI:

- `./robots/barr-e/run-studio.sh`
- `./robots/pip-e/run-studio.sh`
- root wrappers such as `./run-studio-barr-e.sh`
- Studio project picker
- Studio profile picker
- launcher start/stop controls
- Studio work areas currently named workspaces in the codebase, such as `Remote Control`, `Telemetry`, `Models`, `Project`, and `Terminal`

The functional surface exists. The missing piece is a stable operational contract behind it.

### Evidence

Original artifacts were written under `/tmp/robotick-baseline/`. They are temporary run evidence, not durable project artifacts.

| Artifact                         | Path                                                   |
| -------------------------------- | ------------------------------------------------------ |
| First run full-window screenshot | `/tmp/robotick-baseline/output/barr-e-studio-full.png` |
| First run RC screenshot          | `/tmp/robotick-baseline/output/barr-e-rc.png`          |
| First run timing log             | `/tmp/robotick-baseline/output/baseline-log.json`      |
| Rerun full-window screenshot     | `/tmp/robotick-baseline/rerun/studio-full.png`         |

Execution timings:

| Step                                  | Duration |
| ------------------------------------- | -------: |
| Launch Studio to attachable renderer  |  `6-12s` |
| Attach via Electron CDP               |  `0.54s` |
| Click `Start launcher`                |  `0.05s` |
| UI acknowledgment via `Stop launcher` |  `0.01s` |
| First run: RC placeholder gone        | `33.16s` |
| First run: save full screenshot       |  `0.48s` |
| First run: save RC screenshot         |  `0.51s` |
| Stop launcher                         |  `6.88s` |
| Click Studio close                    |  `0.03s` |
| Rerun: RC placeholder gone            | `20.08s` |

Human-equivalent discovery cost for a cold operator was approximately `10-18 min`, mostly spent finding the canonical launch path, discovering the usable automation route, inspecting UI state, resolving selector ambiguity, and correcting a false readiness heuristic.

### Observed Problems

The baseline exposed six concrete UX and contract problems:

- Launch flow is discoverable only by repo knowledge. A cold user must find the right wrapper script and understand the shared Studio checkout.
- Several different states look like "launched": request accepted, launcher running, placeholder gone, canvas present, stream alive, robot visible, and models healthy.
- The first readiness heuristic was wrong. `placeholder gone` plus `canvas exists` did not mean Remote Control was usable; the overlay still showed `Receive: 0.0 Hz` and `Present: 0.0 Hz`.
- Runtime failures are not surfaced as structured state. The UI can progress while important models fail, including observed `barr-e-face` exit status `137`.
- Shutdown usually exits, but quality is weak. The known hang shape is `Waiting for background tasks to complete. (CTRL+C to force quit)`, likely involving terminal log websocket reconnects during launcher shutdown.
- Window visibility/focus is not externally queryable. The Electron window existed and was interactive via CDP, but proving user-visible desktop state was harder than it should be.

## Design Goals

The MVP goal is to make launch, readiness, capture, stop, and quit obvious, deterministic, and reliable for humans and external automation.

The design is grounded in these principles:

- operational state should be named, typed, and inspectable
- one-shot CLI commands, immediate-mode shell commands, Studio, tests, and future clients should share the same underlying contract
- readiness should be classed and evidence-based, not a bare boolean
- Studio workbench/viewer readiness must not be confused with launcher/runtime readiness
- capture should be a first-class operation with metadata and trust decisions, not an improvised screenshot
- shutdown should expose state and blockers
- launcher lifecycle belongs to the Robotick workspace, not to one Studio instance
- Studio target-project selection and launcher run identity are separate concepts
- the contract should leave room for multiple Studio windows, per-window workbenches, layout tabs, floating panels, and direct data-source queries

## Scope

MVP scope is the local operational control plane and the client surfaces required to prove the Barr.e baseline flow:

- `robotick-hub` as the local workspace service and capability contract
- `robotick` CLI in one-shot and immediate-shell modes
- Studio instance registration, inspection, project binding, workbench discovery, viewer readiness, capture, and quit state
- launcher service and launcher-run lifecycle through the hub
- first-class readiness, failure, capture, compatibility, and shutdown contracts
- Studio work-area rename from `workspace` to `workbench`
- first-class project-backed Studio workbench/layout resources with migration from legacy storage
- operator and automation documentation for the canonical flow

MCP is intentionally out of scope for MVP. It should later wrap the same hub-backed operational truth rather than adding privileged behaviour, parallel state semantics, or a second control plane.

## System Architecture

The proposed architecture is a small local control plane exposed through a human/script CLI and Studio:

- `robotick-hub` owns the long-running local workspace API, capability registry, capability orchestration, service lifecycle policy, and desktop tray presence when appropriate
- `robotick-cli` owns command language, one-shot argv mode, immediate shell mode, output rendering, and hub client behavior
- Studio is a UI client of `robotick-hub`; it should not start, stop, supervise, or directly own launcher services
- `robotick-launcher` remains a focused launcher capability provider, exposed through stable hub-facing service functions and compatibility metadata
- future clients should speak to `robotick-hub` or the same hub-backed command contracts

The stable user-facing command is `robotick`. The root `./tools/robotick` shim is a workspace bootstrap and local fallback, not the long-term owner of the command.

Recommended source ownership:

```text
tools/
  robotick-cli/
    src/
      robotick_cli/
        __main__.py
        app/
          context.py
          errors.py
        language/
          parse.py
          route.py
          help.py
        interfaces/
          argv.py
          repl.py
        hub_client.py
        output.py

  robotick-hub/
    src/
      robotick_hub/
        app.py
        contracts/
          health.py
          capabilities.py
          launcher.py
          studio.py
          workspace.py
        api/
          health.py
          capabilities.py
          launcher.py
          studio.py
          workspace.py
        capabilities/
          launcher.py
          studio.py
          workspace.py
        runtime/
          service_registry.py
          process_tree.py
          ports.py
```

These folders are allowed to start small. Further subdivision should be demand-led. For example, `robotick_hub/capabilities/studio/capture/` should exist only once capture behavior and tests justify it.

### Hub Ownership Model

`robotick-hub` is the only long-running local Robotick control service for a workspace. It composes first-party capabilities through explicit service/library contracts, provisions managed services, and discovers external services such as already-open Studio instances.

Hub policy:

- commands that need hub-backed state call `ensure_hub()` before doing work
- entering the immediate `robotick` shell eagerly ensures `robotick-hub` so desktop operators get visible hub/tray presence
- commands such as `--help` do not start hub-backed services
- one `robotick-hub` exists per Robotick workspace at a time
- hub reuse requires liveness, workspace identity, singleton lock ownership, and compatible `api_contract_version`
- a healthy-but-incompatible hub is restarted rather than reused
- desktop hub start establishes tray presence; headless environments may run without it

### Capability Model

Capabilities are first-party operational domains exposed through the hub.

- embedded capabilities live inside `robotick-hub`, such as simple workspace/project queries
- managed capabilities are started/stopped by `robotick-hub`, such as launcher runtime execution
- discovered capabilities are registered or observed by `robotick-hub`, such as open Studio instances

Each capability exposes typed metadata: id, kind, source, state, endpoint if any, health, supported operations, compatibility version, and build id.

Long-running managed capabilities must expose explicit compatibility metadata. Supervisor decisions should not depend on accidental endpoint failures.

### Launcher Model

Launcher is a Robotick-workspace-scoped capability/service, not a singleton bound to one Studio instance or one project. It supports runs beneath the service. Each run has its own run id, target project, profile, status, requested stages, target models, and optional owning Studio instance id.

Launcher reuse is compatibility-checked by hub. An old but still live launcher must be stopped and relaunched when its declared launcher contract no longer matches the hub expectation.

Early concurrency may be constrained to one active run per `(project_id, profile_id)`, but that constraint must be explicit policy with a stable failure code.

### Studio Model

Each running Studio instance advertises a stable instance id. Registration includes process id, selected target project if any, control endpoint, app lifecycle state, version/build metadata, and windows.

Opening Studio without a project means `selected_target_project_id = null`, not an implicit fake default project. Studio should still show the full workspace project list from the hub.

Studio discovery is registry-backed and reconciled against live process truth and, when available, control-endpoint truth. Reconciled states include `running`, `degraded`, `stale`, and `gone`.

Studio work areas should be called workbenches. `robotick_workspace` remains the checkout/runtime-registration concept; `studio_workbench` is the Studio route/work-area concept.

## Command And UX Contract

The CLI uses a path-oriented grammar:

- context-forming commands behave like directories
- action commands behave like executable files
- the shell prompt renders the current bound context stack
- `back` pops one shell level
- `exit` leaves the Robotick CLI itself
- `quit` closes a Studio instance
- `ls` presents context-forming entries separately from actions where useful

Command hierarchy:

- `robotick`
  top-level entrypoint and shell root
- `robotick studio`
  Studio namespace
- `robotick launcher`
  launcher namespace for robot/model runtime lifecycle
- `robotick studio create`
  create/materialize a new Studio instance without changing context
- `robotick studio open`
  composite convenience command that creates or registers a Studio instance and returns or binds its identity
- `robotick studio <instance>`
  enter or target an existing Studio instance context
- `robotick studio <instance> project ...`
  bind or operate on project state within that instance
- `robotick studio <instance> workbench ...`
  bind or operate on Studio workbench state within that instance
- `robotick studio <instance> viewer ...`
  bind or operate on viewer state within that instance
- `robotick studio <instance> wait-ready viewer ...`
  wait for Studio workbench/viewer readiness
- `robotick studio <instance> capture ...`
  capture panels or views from that instance
- `robotick studio <instance> quit`
  close the targeted Studio instance
- `robotick launcher launch|stop|status|wait-ready ...`
  operate on robot/model lifecycle through the launcher capability

Interactive prompt examples:

```text
robotick>
robotick:studio>
robotick:studio:studio-12345>
```

Top-level capability namespaces remain addressable from a bound prompt, but they keep their ownership model. For example, invoking `launcher launch ...` from `robotick:studio:studio-12345>` may attach `owner_studio_instance_id` metadata for diagnostics and UX, but launcher service identity remains Robotick-workspace-scoped.

### Command Semantics

`create` materializes a Studio instance and returns its instance identity. It does not change one-shot caller context. In immediate mode it keeps the shell in the current context unless a later command explicitly binds it.

`open` launches or registers a Studio instance and returns a targetable `studio_instance`. In immediate mode it may bind the prompt to that instance.

Instance targeting uses explicit ids in one-shot mode, such as `robotick studio studio-12345 ...`. In immediate mode, once bound, unqualified Studio-scoped commands operate on the current instance.

`launcher launch` returns a machine-targetable `launcher_run` identity such as `launcher-full-67890`. Launch subtype is also explicit in fields such as `launch_kind`, `profile_id`, `requested_stages`, and optional `target_models`; callers must not parse the id to recover that meaning.

`launcher wait-ready` and `launcher stop` target explicit run ids. They do not silently operate on ambient singleton runtime state.

`wait-ready viewer` never creates a viewer. It waits against an existing Studio instance/window/workbench/panel/viewer target and, when relevant, a referenced launcher run id.

`capture` writes or returns a `capture_result` tied to explicit Studio and runtime context. It is not an implicit side effect of `wait-ready`.

`quit` targets a Studio instance. `stop` targets a launcher run. `--wait` changes blocking behavior, not resource identity or ownership.

`--json` serializes the underlying resource or operation result with minimal presentation wrapping.

### Example Flow

```bash
robotick studio projects
robotick studio open
robotick studio instances
robotick studio studio-12345 project barr-e
robotick launcher launch --project barr-e --profile local:ALL --owner-instance studio-12345
robotick launcher wait-ready launcher-full-67890 --readiness launcher-run
robotick studio studio-12345 wait-ready viewer --workbench remote-control --panel main --run launcher-full-67890
robotick studio studio-12345 capture panel --workbench remote-control --panel main --run launcher-full-67890 --require capture-ready --out artifacts/...
robotick launcher stop launcher-full-67890
robotick studio studio-12345 quit --wait
```

```text
robotick> studio
robotick:studio> projects
robotick:studio> open
robotick:studio:studio-12345> project barr-e
robotick:studio:studio-12345> launcher launch --project barr-e --profile local:ALL
robotick:studio:studio-12345> launcher wait-ready launcher-full-67890 --readiness launcher-run
robotick:studio:studio-12345> wait-ready viewer --workbench remote-control --panel main --run launcher-full-67890
robotick:studio:studio-12345> capture panel --workbench remote-control --panel main --run launcher-full-67890 --require capture-ready --out artifacts/...
robotick:studio:studio-12345> launcher stop launcher-full-67890
robotick:studio:studio-12345> quit
```

## Workspace Manifest

The root `robotick.yaml` is static workspace registration, not readiness policy or artifact policy.

Initial shape:

```yaml
schema_version: 1

studio:
  default_path: robotick/robotick-studio
  default_mode: dev

projects:
  barr-e:
    project_dir: robots/barr-e

  pip-e:
    project_dir: robots/pip-e
```

Readiness is product state reported through hub, launcher, and Studio contracts. It does not belong in `robotick.yaml`.

Docs are split clearly:

- `README.md` documents the normal human `robotick studio ...` flow
- `AGENTS.md` gives bots and advanced automation a concise operational entrypoint

Humans should not need `AGENTS.md` to discover how to launch Studio.

## Hub API Contract

The MVP hub transport is localhost HTTP/JSON backed by FastAPI/Pydantic contracts. WebSocket event streams can be added later.

Initial hub endpoints:

- `GET /v1/health`
  reports hub liveness, Robotick workspace identity, `api_contract_version`, and `build_id`
- `GET /v1/capabilities`
  lists embedded, managed, and discovered capabilities plus health/endpoint summaries
- `GET /v1/workspace/projects`
  lists registered workspace projects without requiring launcher runtime state
- `GET /v1/studio/projects`
  returns the same workspace project list in Studio-facing shape, plus current target-project metadata when a Studio instance is bound
- `POST /v1/capabilities/launcher/ensure`
  ensures the launcher capability is available when a command needs it
- `GET /v1/launcher/status`
  reports launcher service and run state
- `POST /v1/studio/open`
  opens/registers a Studio instance with the hub endpoint configured
- `GET /v1/studio/instances`
  lists known Studio instances
- `POST /v1/studio/instances/{id}/quit`
  requests graceful Studio quit for a known instance

Future Studio endpoints should expose status, project binding, workbench discovery, viewer status/recovery, readiness, capture, and shutdown state through the same typed resource contract.

## Resource And State Contract

This section defines the MVP resource model. It is concrete enough that CLI, hub, Studio, and launcher implementations should converge on the same state semantics.

### Terminology

- `robotick_workspace`
  the repository/workspace checkout containing `robotick.yaml`
- `studio_workbench`
  Studio's own route/work-area concept, such as `remote-control`, `telemetry`, `models`, or a future per-window custom workbench
- `workspace_id`
  avoided in contracts unless the surrounding resource makes the namespace unambiguous; prefer `robotick_workspace_id` or `studio_workbench_id`

MVP does not need every Studio workbench operation. It does need a shape that supports secondary windows, per-window custom workbenches, multiple layout tabs, docked panels, floating panels, and direct data-source queries.

### Canonical Resource Types

- `robotick_workspace`
  checkout-scoped identity and project registration truth
- `hub_capability`
  a capability exposed by `robotick-hub`
- `studio_instance`
  one open Studio app instance known to the hub
- `studio_window`
  one Electron window within a Studio instance
- `studio_project_binding`
  the current target-project selection for a Studio instance
- `studio_workbench`
  one Studio workbench surface available in a window or window template
- `studio_layout_tab`
  one saved layout tab inside a Studio workbench
- `studio_panel`
  one docked or floating panel instance hosting an editor
- `studio_editor`
  one registered editor/tool that can be hosted in a panel
- `launcher_service`
  the Robotick-workspace-scoped launcher capability/service
- `launcher_run`
  one runtime launch attempt or active runtime beneath the launcher service
- `data_source_target`
  a direct query target such as telemetry stream, launcher status endpoint, model registry, or project model descriptor
- `viewer_state`
  the state of a specific viewer or view-like target
- `capture_result`
  the result of one capture operation, including metadata and trustworthiness
- `shutdown_state`
  staged shutdown state for an app or service being asked to stop

### Id Rules

- all canonical ids are opaque strings, not integers
- ids are stable for the lifetime of the resource they identify
- display labels may mirror canonical ids during MVP, but callers treat ids as opaque
- `robotick_workspace_id` is stable for the checkout and includes machine-usable root path plus stable workspace id
- `studio_instance_id` is Robotick-workspace-scoped and stable until that Studio instance is gone
- `studio_window_id` is scoped to a Studio instance and maps to Electron `windowScope`
- `studio_workbench_id` is scoped to a Studio window; built-in ids such as `remote-control` remain stable, and future custom ids are opaque
- `layout_tab_id` is scoped to `(studio_window_id, studio_workbench_id)`
- `panel_id` is scoped to `(studio_window_id, studio_workbench_id, layout_tab_id, surface_kind)`
- `editor_id` is a registered editor id, not a panel id
- `launcher_service_id` is Robotick-workspace-scoped
- `launcher_run_id` is unique within a Robotick workspace and never reused; examples use typed shapes such as `launcher-full-67890`
- project names such as `barr-e` are canonical project ids for MVP

### Common Fields

Every resource response includes `resource_type` and canonical `id`. Long-lived resources include `state`. Machine timestamps use RFC 3339 UTC. Degraded or failed states include machine-readable reason data rather than prose-only explanation.

Studio context fields such as `studio_window_id`, `studio_workbench_id`, `layout_tab_id`, and `panel_id` may be `null` when an operation intentionally targets a direct data source rather than visible Studio UI.

### Capability Resources

`hub_capability` fields:

- `id`
- `kind`
- `source`
- `state`
- `api_contract_version`
- `build_id`
- `endpoint`
- `supported_operations`
- `last_seen_at`
- `health`

`kind`: `robotick_workspace`, `studio`, `launcher`, future capability ids.

`source`: `embedded`, `managed`, `discovered`.

`state`: `unavailable`, `starting`, `ready`, `degraded`, `stopping`, `stopped`, `failed`, `stale`.

### Robotick Workspace

`robotick_workspace` fields:

- `id`
- `root_path`
- `schema_version`
- `studio_default_path`
- `studio_default_mode`
- `projects`

`projects` is an array of `{ id, project_dir, display_name }`.

### Studio Resources

`studio_instance` fields:

- `id`
- `state`
- `mode`
- `pid`
- `process_group_id`
- `started_at`
- `last_seen_at`
- `selected_target_project_id`
- `control_endpoint`
- `registration_source`
- `app_version`
- `build_id`
- `windows`

`studio_instance.state`: `launch_requested`, `launching`, `running`, `degraded`, `quitting`, `stopped`, `gone`, `stale`, `failed`.

`registration_source`: `hub_open`, `self_register`, `discovered`.

`studio_window` fields:

- `id`
- `studio_instance_id`
- `scope`
- `is_primary`
- `state`
- `current_studio_workbench_id`
- `available_studio_workbenches`
- `active_child_window_scopes`
- `bounds`
- `is_visible`
- `is_focused`
- `last_seen_at`

`studio_window.state`: `opening`, `visible`, `hidden`, `focused`, `unfocused`, `closing`, `closed`, `stale`, `failed`.

`studio_project_binding` fields:

- `studio_instance_id`
- `project_id`
- `bound_at`

`project_id` may be `null`.

`studio_workbench` fields:

- `id`
- `studio_window_id`
- `path`
- `label`
- `group`
- `default_editor_id`
- `allowed_editor_ids`
- `source`
- `state`

`studio_workbench.source`: `builtin`, `project`, `user`, `session`.

`studio_workbench.state`: `available`, `active`, `hidden`, `removed`, `failed`.

`studio_layout_tab` fields:

- `id`
- `studio_window_id`
- `studio_workbench_id`
- `name`
- `state`
- `panel_tree_root_id`
- `panel_ids`
- `floating_panel_ids`

`studio_layout_tab.state`: `available`, `active`, `closing`, `closed`, `stale`.

`studio_panel` fields:

- `id`
- `studio_window_id`
- `studio_workbench_id`
- `layout_tab_id`
- `surface_kind`
- `editor_id`
- `title`
- `state`
- `settings`
- `bounds`
- `parent_panel_id`

`surface_kind`: `docked`, `floating`.

`studio_panel.state`: `loading`, `ready`, `degraded`, `failed`, `closed`, `stale`.

`studio_editor` fields:

- `id`
- `label`
- `source`
- `plugin_id`
- `supported_observations`
- `supported_captures`

### Launcher Resources

`launcher_service` fields:

- `id`
- `state`
- `api_contract_version`
- `build_id`
- `endpoint`
- `pid`
- `started_at`
- `last_seen_at`
- `supported_profiles`
- `health`

`launcher_service.state`: `unavailable`, `starting`, `ready`, `degraded`, `stopping`, `stopped`, `failed`, `stale`.

`launcher_run` fields:

- `id`
- `state`
- `operation_kind`
- `launch_kind`
- `project_id`
- `profile_id`
- `requested_stages`
- `target_models`
- `owner_studio_instance_id`
- `created_at`
- `started_at`
- `stopped_at`
- `exit_code`
- `failure`
- `runtime_readiness`
- `active_studio_workbench_id`
- `active_viewer_id`

`operation_kind`: `launch`.

`launch_kind`: `full`, `build-only`, `profile-subset`, `model-subset`, future launch kinds.

`launcher_run.state`: `launch_requested`, `launching`, `running`, `healthy`, `degraded`, `failed`, `stopping`, `stopped`.

`owner_studio_instance_id` may be `null`.

### Data Source, Viewer, And Capture Resources

`data_source_target` fields:

- `id`
- `kind`
- `project_id`
- `launcher_run_id`
- `model_id`
- `endpoint`
- `state`
- `readiness`
- `latest_metrics`

`data_source_target.kind`: `telemetry_stream`, `launcher_status`, `project_models`, `workload_registry`, `viewer_engine`.

`data_source_target.state`: `unknown`, `available`, `streaming`, `degraded`, `failed`, `stale`.

`viewer_state` fields:

- `id`
- `studio_instance_id`
- `studio_window_id`
- `studio_workbench_id`
- `layout_tab_id`
- `panel_id`
- `surface_kind`
- `editor_id`
- `viewer_id`
- `observation_source`
- `data_source_target_id`
- `state`
- `view_readiness`
- `latest_metrics`
- `last_frame_at`
- `degraded_reasons`

`observation_source`: `panel`, `viewer_engine`, `telemetry_data_source`, `launcher_service`.

`viewer_state.state`: `unknown`, `inactive`, `selected`, `streaming`, `degraded`, `failed`, `stale`.

`capture_result` fields:

- `id`
- `studio_instance_id`
- `studio_window_id`
- `project_id`
- `launcher_run_id`
- `studio_workbench_id`
- `layout_tab_id`
- `panel_id`
- `surface_kind`
- `editor_id`
- `viewer_id`
- `data_source_target_id`
- `capture_target_kind`
- `captured_at`
- `output_path`
- `state`
- `capture_readiness`
- `runtime_readiness_summary`
- `viewer_readiness_summary`
- `failure`

`capture_target_kind`: `panel`, `viewer`, `telemetry_snapshot`, `launcher_status`, `diagnostics`.

`capture_result.state`: `capture_requested`, `capturing`, `captured`, `degraded`, `failed`.

### Shutdown Resources

`shutdown_state` fields:

- `id`
- `target_resource_type`
- `target_resource_id`
- `state`
- `started_at`
- `finished_at`
- `blocking_conditions`
- `timeout_at`
- `failure`

`shutdown_state.state`: `shutdown_requested`, `quitting`, `draining`, `stopped`, `timed_out`, `failed`.

### State Transitions

Normative transitions:

- `studio_instance`: `launch_requested -> launching -> running`; `running -> degraded|quitting|failed`; `degraded -> running|quitting|failed`; `quitting -> stopped|gone|failed`; `stopped|gone|failed` are terminal
- `studio_window`: `opening -> visible|focused`; `visible -> focused|unfocused|closing|failed`; `focused -> visible|unfocused|closing|failed`; `closing -> closed|failed`
- `studio_panel`: `loading -> ready|degraded|failed`; `ready -> degraded|closed|failed`; `degraded -> ready|closed|failed`; `closed|failed` are terminal
- `launcher_service`: `unavailable -> starting -> ready`; `ready -> degraded|stopping|failed`; `degraded -> ready|stopping|failed`; `stopping -> stopped|failed`
- `launcher_run`: `launch_requested -> launching -> running|healthy|degraded|failed`; `running -> healthy|degraded|stopping|failed`; `healthy -> degraded|stopping|failed`; `degraded -> healthy|stopping|failed`; `stopping -> stopped|failed`
- `capture_result`: `capture_requested -> capturing -> captured|degraded|failed`
- `shutdown_state`: `shutdown_requested -> quitting -> draining -> stopped`; timeout or unrecoverable error moves to `timed_out` or `failed`

## Readiness, Failure, And Compatibility

Readiness payloads are not bare booleans. They include `readiness_class`, `status`, `checked_at`, `reasons`, and `evidence`.

`readiness_class`: `launcher_capability`, `launcher_run`, `studio_workbench`, `studio_panel`, `data_source`, `viewer`, `capture`.

`status`: `unknown`, `not_ready`, `ready`, `degraded`, `failed`.

Reason object fields:

- `code`
- `scope`
- `message`
- `retryable`
- `details`

`scope`: `robotick_workspace`, `studio_instance`, `studio_window`, `studio_workbench`, `studio_layout_tab`, `studio_panel`, `launcher_service`, `launcher_run`, `data_source`, `viewer`, `capture`, `shutdown`.

Minimum readiness evidence:

- launcher capability readiness includes compatibility status and endpoint liveness
- launcher run readiness includes required-model health, telemetry read/write availability, and critical runtime failures
- Studio workbench readiness includes instance, window scope, available workbench ids, active workbench id, and whether the requested workbench exists, is active, hidden, removed, or failed
- Studio panel readiness includes window/workbench/layout-tab identity, surface kind, panel id, editor id, and panel loading/degraded/stale state
- viewer readiness includes selected Studio window/workbench/layout/panel identity when panel-derived, plus receive/present or equivalent freshness signals
- direct data-source readiness includes endpoint liveness, schema/session freshness, and latest sample or status freshness without requiring a panel
- capture readiness includes placeholder/non-placeholder truth and whether the target has enough recent trustworthy data

Failure object fields:

- `code`
- `message`
- `retryable`
- `scope`
- `related_resource_ids`
- `details`
- `observed_at`

Stable failure codes include `launcher_contract_mismatch`, `model_exit_nonzero`, `viewer_no_frames`, `capture_target_placeholder`, and `shutdown_timeout`.

`api_contract_version` is the compatibility gate for hub-managed reuse. `build_id` identifies the concrete implementation build for diagnostics, not compatibility by itself. Incompatibility surfaces as explicit supervised state and failure code.

## Studio Workbench Persistence

Studio workbenches and layouts take meaningful human effort to perfect. They should be treated as first-class project resources, not hidden browser-storage leftovers.

The current Electron persistence already has file-backed JSON precedent:

- `.studio/window-state.json`
  stores Electron window geometry/state
- `.studio/renderer-storage.json`
  stores a generic string-key renderer storage map behind the current storage bridge

The MVP should promote durable Studio workbench/layout/panel/viewer state out of generic renderer storage and into explicit per-project Studio resource files with product-level names, versioning, and atomic writes.

`window-state.json` should shrink to true window/session chrome state. Important workbench definitions, layout tabs, panel layouts, floating panels, and viewer defaults should move into dedicated project-backed JSON resources rather than an opaque `renderer-storage.json` bucket.

Migration requirements:

- read legacy storage keys and legacy on-disk renderer storage
- preserve current `workspace`-named keys during the `workbench` rename
- also tolerate any new `workbench` aliases introduced during transition
- write the canonical project resource form without data loss
- keep legacy loading long enough that existing Studio state survives normal use

JSON is preferred over YAML for this persisted UI state. Studio already uses YAML for static app configuration, while runtime/persisted Electron-side state is already JSON-oriented.

## Capture And Shutdown

Capture is a first-class operation, not a screenshot improvised through UI automation. It must be available through Robotick commands and hub/Studio contracts in both dev and packaged modes. Agents should not scrape log files for Electron remote-debugging ports or speak raw CDP for basic capture.

Minimum capture metadata:

- timestamp
- project
- Studio instance
- Studio window
- Studio workbench
- layout tab when panel-derived
- panel/editor when panel-derived
- data-source target when direct
- selected viewer option when relevant
- launcher run id when relevant
- model/runtime readiness summary
- Studio workbench/viewer readiness summary
- capture target kind
- capture readiness decision
- failure/degraded reasons

Remote Control readiness is a Studio workbench/viewer readiness projection over launcher-run truth plus view-specific receive/present signals. Launcher-run readiness alone is not enough to prove an RC screenshot or panel capture will be meaningful.

Shutdown is staged:

1. renderer enters `quitting`
2. reconnecting clients stop reconnecting
3. websocket/log tasks drain or are cancelled
4. app reports `quit_complete`

Launcher shutdown is a separate Robotick lifecycle operation, not part of Studio quit. The hub and CLI expose shutdown blockers rather than leaving the user at `CTRL+C to force quit`.

## Implementation Baseline

The current implementation has already moved beyond raw wrapper scripts:

- root `robotick.yaml` defines default Studio path/mode and registered projects
- `README.md` documents the human `robotick studio ...` flow and `AGENTS.md` documents the concise bot/operator supplement
- `robotick/robotick-studio/tools/robotick-cli/` provides a Python Robotick operations CLI
- the CLI supports one-shot argv mode and immediate shell mode through the same language/routing layer
- command/help/shell discovery output comes from a shared command registry
- `tools/robotick-hub/` provides a Python/FastAPI/Pydantic service with health, capabilities, Robotick workspace identity, service registry, and workspace project listing
- desktop sessions can show `robotick-hub` tray presence from the same Python process
- launcher capability is routed through hub for ensure/status/stop/endpoint discovery and managed-worker lifecycle
- shared workspace/project queries now live on hub-backed paths
- `robotick studio open` ensures hub, asks hub to ensure required capabilities, and opens/registers Studio through hub-owned endpoints
- Studio no longer starts, stops, supervises, or force-kills launcher processes during its own boot/shutdown path
- `quit` prefers the Studio control API slot when available and falls back clearly to process-group shutdown
- hub exposes a reusable app-closing signal path, and Studio emits a best-effort closing notification
- immediate-shell error handling keeps the shell alive after expected command failures and unexpected command exceptions

Current workflow reality remains incomplete for the MVP contract:

- `robotick studio` exposes only the current hello-world subset plus minimal instance commands
- `robotick launcher` exposes only the current routed status path
- Studio instance records can still have `control_endpoint: null`
- Studio has no typed workbench/panel/viewer inspection surface yet
- capture is still possible only through a dev-mode CDP workaround
- Remote Control can still require manual refresh to recover
- launcher truth is still too ambient for capture workflows
- hub/service singleton and compatibility reuse still need formal enforcement

## MVP Acceptance Flow

The Barr.e baseline should become a flow with explicit Studio instance identity, explicit launcher run identity, and explicit readiness class.

One-shot flow:

```bash
robotick studio open --json
robotick studio studio-12345 project barr-e
robotick launcher launch --project barr-e --profile local:ALL --owner-instance studio-12345 --json
robotick launcher wait-ready launcher-full-67890 --readiness launcher-run
robotick studio studio-12345 wait-ready viewer --workbench remote-control --panel main --run launcher-full-67890
robotick studio studio-12345 capture panel --workbench remote-control --panel main --run launcher-full-67890 --require capture-ready --out artifacts/...
robotick launcher stop launcher-full-67890
robotick studio studio-12345 quit --wait
```

Interactive flow:

```text
robotick studio
open
robotick:studio:studio-12345>
ls
project barr-e
launcher launch --project barr-e --profile local:ALL
launcher wait-ready launcher-full-67890 --readiness launcher-run
wait-ready viewer --workbench remote-control --panel main --run launcher-full-67890
capture panel --workbench remote-control --panel main --run launcher-full-67890 --require capture-ready --out artifacts/...
launcher stop launcher-full-67890
quit
```

The future client requirement is direct: an operator, bot, or test should complete this flow without repo rummaging, script-path discovery, UI selector discovery, visual-state guessing, or log scraping for basic operational truth.

## Future Work

Future work should wrap or extend the same operational contract rather than creating separate privileged behavior.

Deferred areas:

- optional OS/session startup for `robotick-hub`
- launcher internals refactored toward embeddable capability services
- artifact/output conventions after capture workflows settle
- richer log inspection and tailing commands
- richer Studio workbench, viewer, diagnostics, capture, and child-window coverage
- MCP adapter over the same operational contract
- broader telemetry/model inspection commands
- stronger visibility/focus/window-state introspection
- Python or other scripting clients over the same contract
- embedded in-Studio agent UX once the operational contract is stable
- richer autonomous creative workflows built on scenario generation, expressive regression tests, historical run memory, and behaviour synthesis
