# Robotick CLI And Agentic UX

Date: 2026-06-05
Baseline project: `robots/barr-e`

## Why This Matters

Robotick is not just gaining a nicer command line. It is learning how to explain its own workshop.

Today, Studio is a powerful human tool. It can launch robots, inspect models, show telemetry, drive viewports, and help shape expressive behaviour. But much of that knowledge still lives in a human operator's head: which script to run, which window matters, which log line is bad, whether a blank viewport means "not ready yet" or "broken", and when it is safe to capture evidence or shut everything down.

The immediate goal is to make those truths explicit. Studio instances, launcher services, robot runs, readiness classes, viewer state, capture results, and shutdown blockers should all become named, typed, inspectable things.

That is useful in ordinary ways first. A CLI can make daily bring-up less fiddly. A hub can stop stale services and duplicate launchers becoming mysterious. Tests can open Barr.e, wait for real readiness, capture the Remote Control view, save useful metadata, and close cleanly. A cold engineer, hobbyist, or future contributor can ask the system what exists instead of rummaging through scripts and guessing from UI state.

The larger payoff is more interesting. Once Robotick exposes its workbench as a stable operational world, agents can begin to participate in the creative robotics loop. Not as magic robot brains, and not as a replacement for Robotick's runtime, but as tireless workshop assistants that can operate the tools, observe the results, and help improve the system.

That opens up several genuinely valuable workflows:

- an agent can bring up Barr.e overnight, notice that the face model crashed, capture the exact degraded state, compare it with yesterday's run, and leave a concise report with the real failure boundary rather than a pile of logs
- an agent can generate a new robot project skeleton, wire the declared workloads, run validation, open Studio, inspect missing telemetry, and point to the precise contract or connection that failed
- an agent can try three versions of a curious head-turn, capture each one, compare timing curves and viewer output, and help decide which behaviour reads most alive
- an agent can run expressive regression sweeps across many saved scenarios and tell you not only that motion changed, but that it now looks hesitant, abrupt, flat, or emotionally incoherent compared with previous runs
- an agent can search for personality bugs: places where Barr.e's face, posture, attention, and memory cues stop feeling like one being and start feeling like disconnected subsystems
- an agent can build small simulation scenes or scripted provocations to elicit surprise, caution, curiosity, frustration, or recovery, then compare how different robot versions respond
- an agent can help turn puppeteered discoveries into reusable behaviour by capturing what worked in a live session, tracing the relevant telemetry and state transitions, and proposing the procedural logic needed to reproduce it
- an agent can maintain a historical memory of runs, asking questions like "when did Barr.e stop recovering cleanly from this state?" or "which change made this hesitation start reading as intentional instead of broken?"

That is why the CLI matters. It is not a side quest into shell tooling. It is the first step toward making Robotick's creative-technical workshop legible: commandable by humans, inspectable by tests, usable by Studio, and eventually shareable with agents through the same operational truth.

## Problem Statement

Robotick Studio is usable by a human who already knows the repo and UI, but it is not yet operationally self-describing. A cold operator, script, or external agent has to infer too much from shell scripts, UI state, logs, and visual changes.

The baseline task was deliberately simple:

1. launch Studio
2. launch Barr.e
3. capture the main Remote Control viewport
4. stop Barr.e cleanly
5. exit Studio cleanly

The task completed mechanically, but the path was fragile. The first run captured a black RC viewport even though the UI had moved past its placeholder state. The second run produced a better visual result. That variation is itself evidence that current readiness and visual-success signals are not explicit enough.

### Current Entry Points

Current human usage is based on repo scripts and the Studio UI:

- `./robots/barr-e/run-studio.sh`
- `./robots/pip-e/run-studio.sh`
- root wrappers such as `./run-studio-barr-e.sh`
- Studio project picker
- Studio profile picker
- launcher start/stop controls
- workspaces such as `Remote Control`, `Telemetry`, `Models`, `Project`, and `Terminal`

The functional surface is already there. The missing piece is a stable operational contract behind it.

### Baseline Evidence

Original artifacts were written under `/tmp/robotick-baseline/` and should be treated as temporary run evidence, not durable project artifacts.

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

Human-equivalent discovery cost for a cold operator/engineer was approximately `10-18 min`, mostly spent finding the canonical launch path, discovering the usable automation route, inspecting UI state, resolving selector ambiguity, and correcting a false readiness heuristic.

### Findings

The current workflow has six concrete UX problems:

- Launch flow is discoverable only by repo knowledge. A cold user must find the right wrapper script and understand the shared Studio checkout.
- Several different states look like "launched": request accepted, launcher running, placeholder gone, canvas present, stream alive, robot visible, and models healthy.
- The first readiness heuristic was wrong. `placeholder gone` plus `canvas exists` did not mean RC was usable; the overlay still showed `Receive: 0.0 Hz` and `Present: 0.0 Hz`.
- Runtime failures are not surfaced as structured state. The UI can progress while important models fail, including observed `barr-e-face` exit status `137`.
- Shutdown usually exits, but quality is weak. The known hang shape is `Waiting for background tasks to complete. (CTRL+C to force quit)`, likely involving terminal log websocket reconnects during launcher shutdown.
- Window visibility/focus is not externally queryable. The Electron window existed and was interactive via CDP, but proving user-visible desktop state was harder than it should be.

## Proposal

Build a small, explicit local control plane for Robotick capabilities, then expose it through a human/script CLI and Studio. `robotick-hub` is the local workspace service/API aggregator in that model; Studio and launcher are first-party capabilities exposed through it.

The layers should be:

1. `robotick-hub` local service and capability contract
2. `robotick ...` umbrella CLI as the human/script client
3. workspace project registration and docs
4. Studio over the same hub contract

Additional scripting clients, including MCP, are out of scope for this phase. They can be added later as other clients of the same operational contract.

Testing should be part of implementation throughout, not deferred to the end. Each supported command/state permutation should be locked down as soon as it is introduced, even if that means catch-up tests while the CLI grammar is still being shaped.

### CLI Shape

Use `robotick` as the umbrella command. `studio` is the Studio namespace; `launcher` is the robot/model lifecycle namespace.

The CLI should follow a path-oriented grammar:

- context-forming commands behave like directories
- action commands behave like executables/files
- the shell prompt is a rendering of the current bound context stack
- `back` pops one level from that stack
- `ls` should present context-forming entries with a directory-like feel, for example `studio/` or `studio-12345/`
- one-shot commands and immediate-mode navigation should describe the same hierarchy, while being honest about the fact that one-shot commands cannot leave the caller in a changed CLI context

That metaphor should inform the whole interface:

- `studio` is a context
- `create` is the primitive action that materializes a Studio instance without changing context
- `open` is a composite convenience action over the primitives, initially `create` + bind
- in immediate mode, bind means the prompt may move into the new instance context
- in one-shot argv mode, bind means the command returns a stable instance identity that later commands can target explicitly
- instance folders such as `studio-12345/` are the persistent contexts representing open Studio instances
- later contexts such as `project[...]`, `workspace[...]`, and `viewer[...]` should only appear once they are genuinely bound inside a specific instance folder
- actions such as `launch`, `stop`, `status`, `capture`, and `quit` run within the current bound context rather than pretending to be peers of it

The command hierarchy should therefore be explicit and path-like:

- `robotick`
  top-level entrypoint and shell root
- `robotick studio`
  Studio namespace
- `robotick launcher`
  launcher namespace for robot/model runtime lifecycle
- `robotick studio create`
  create/materialize a new Studio instance without changing context
- `robotick studio open`
  composite convenience command that creates a new Studio instance and returns or binds its instance identity
- `robotick studio <instance>`
  enter or target an existing Studio instance context
- `robotick studio <instance> project ...`
  bind or operate on project state within that instance
- `robotick studio <instance> workbench ...`
  bind or operate on Studio workbench state within that instance
- `robotick studio <instance> viewer ...`
  bind or operate on viewer state within that instance
- `robotick studio <instance> wait-ready viewer ...`
  wait for Studio workbench/viewer readiness within that instance
- `robotick studio <instance> capture ...`
  capture panels or views from that instance
- `robotick studio <instance> quit`
  close the targeted Studio instance
- `robotick launcher launch|stop|status|wait-ready ...`
  operate on robot/model lifecycle through the launcher capability

The interactive shell should mirror that hierarchy rather than inventing different semantics:

- `robotick>`
  top-level shell
- `robotick:studio>`
  Studio namespace shell
- `robotick:studio:studio-12345>`
  shell bound to a specific open Studio instance

Within that bound prompt, unqualified Studio-scoped commands should be understood as operating on the currently open Studio instance. In other words, `studio-12345/` is the user-facing hierarchy for “the Studio instance I currently have open”, and the shell should behave as though the user has `cd`'d into that instance.

Top-level capability namespaces remain addressable from a bound prompt, but they keep their own ownership model. For example, `launcher` is a Robotick-workspace-scoped capability with explicit runs beneath it; invoking `launcher launch ...` from `robotick:studio:studio-12345>` may associate the new run with the current Studio instance for UX/diagnostics, but it must not imply that the launcher service itself is owned by that Studio instance.

`back` should always unwind one shell level. The bound-instance prompt is a path/state indicator. Once bound to a Studio instance, the commands available there are the operations and deeper context bindings on that instance, while `open` remains the action used back at `robotick:studio>` to create another instance.

Shell-control commands should stay distinct:

- `back`
  leave the current shell context and return to the parent context
- `exit`
  leave the Robotick CLI itself
- `quit`
  close the currently bound Studio instance, then return to the parent Studio shell context

That also means `ls` should be visually biased toward the path metaphor:

- show context-forming entries separately from actions where useful
- render contexts in a directory-like style, such as `studio/` and `studio-12345/`
- surface concrete enterable contexts only where they are genuinely bound, such as discovered Studio instances and, later, project/Studio-workbench/viewer context within an already open Studio instance
- avoid flattening contexts and actions into one undifferentiated list

Examples:

```bash
robotick studio projects
robotick studio open
robotick studio instances
robotick studio studio-12345 project barr-e
robotick launcher launch --project barr-e --profile local:ALL --owner-instance studio-12345
robotick launcher wait-ready run-67890 --readiness launcher-run
robotick studio studio-12345 wait-ready viewer --workbench remote-control --panel main --run run-67890
robotick studio studio-12345 capture panel --workbench remote-control --panel main --run run-67890 --require capture-ready --out artifacts/...
robotick launcher stop run-67890
robotick studio studio-12345 quit --wait
```

Interactive mode should also be supported:

```text
robotick> studio
robotick:studio> projects
robotick:studio> ls
robotick:studio> open
robotick:studio:studio-12345> project barr-e
robotick:studio:studio-12345> launcher launch --project barr-e --profile local:ALL
robotick:studio:studio-12345> launcher wait-ready run-67890 --readiness launcher-run
robotick:studio:studio-12345> wait-ready viewer --workbench remote-control --panel main --run run-67890
robotick:studio:studio-12345> clear
robotick:studio:studio-12345> quit
robotick:studio> back
robotick> exit
```

Command style:

- use path-forming nouns/contexts for scope: `studio`, instance folders such as `studio-12345`, and later `project`, `workbench`, `viewer`
- use action commands within the current scope for work: `launch`, `stop`, `status`, `capture`, `quit`
- keep top-level capability namespaces such as `launcher` available in immediate mode even when the prompt is bound to a Studio instance
- use positional arguments for direct objects: project, Studio workbench, viewer option, panel id
- use flags for context and modifiers: `--instance`, `--profile`, `--workbench`, `--panel`, `--out`, `--timeout`, `--json`

In CLI examples, `--workbench remote-control` means a Studio workbench id, not the repository/workspace checkout.

CLI output should be human-readable by default, provide `--json` for status/diagnostics, keep normal output quiet, and use explicit exit codes for invalid args, launch failure, readiness timeout, degraded state, and shutdown timeout.

State ownership should stay explicit:

- Robotick workspace identity belongs to `robotick-hub`
- Studio instance identity belongs to the Studio capability and is rendered as folders such as `studio-12345/`
- Studio window identity belongs to a Studio instance
- Studio workbench, layout-tab, panel, floating-panel, and editor state belongs to a specific Studio window
- Studio target-project selection belongs to a Studio instance
- launcher service identity belongs to the Robotick workspace
- launcher run identity belongs to the launcher service and should be represented by explicit run ids
- viewer state may be panel-derived, viewer-engine-derived, or data-source-derived, but should still identify the Studio instance/window/workbench/layout/panel context when one exists
- capture output belongs to the capture operation and should include enough metadata to prove which instance, window, project, run, Studio workbench, layout tab, panel/editor, data source, viewer, and readiness states produced it

### Robotick Workspace Contract

Add a minimal root `robotick.yaml` for static project registration only.

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

Do not put readiness policy or artifact policy in this file. `robotick.yaml` registers Robotick workspace shape; it should not decide whether a runtime, Studio workbench, viewer, or capture is ready. Readiness is product state reported through the hub, launcher, and Studio contracts.

Docs should be split clearly:

- `README.md` documents the normal human `robotick studio ...` flow.
- `AGENTS.md` gives bots and advanced automation the concise operational entrypoint.

Humans should not need `AGENTS.md` to discover how to launch Studio.

### Implementation Architecture

Recommended implementation:

- Phase 0 workspace bootstrap shim: `./tools/robotick`
- intended long-term command name: `robotick`
- CLI source location: `robotick/robotick-studio/tools/robotick-cli/`
- hub source location: `robotick/robotick-studio/tools/robotick-hub/`
- target implementation stack: Python, using Typer/Pydantic for the CLI command language and FastAPI/Pydantic for the hub API contract
- tray/desktop presence for `robotick-hub` should stay in Python too; prefer PyQt5 as the default tray integration rather than pulling the hub into Electron
- current TypeScript/Node CLI implementation is a hello-world slice and should be ported before the CLI grows much more command surface
- normal use should not expose `npm`, `node`, `python`, `pip`, or package-manager details
- a literal root `./robotick` file is not possible in this repo because `robotick/` is already a top-level directory
- an installed `robotick` shim should be able to find the nearest workspace and delegate to its local tool
- the stable user-facing command should be `robotick`; the workspace shim exists only as bootstrap and local fallback

Recommended tool shape:

- `robotick-cli` owns the command language, one-shot argv mode, immediate shell mode, output rendering, and hub client behavior
- `robotick-hub` owns the long-running local workspace API, capability registry, capability orchestration, and service lifecycle policy
- `robotick-hub` remains a Python service first; desktop tray presence should be a thin PyQt5 layer over that same process rather than a second app or an Electron rewrite
- `robotick-launcher` remains a focused launcher capability provider; it should expose stable APIs for hub integration while keeping `robotick-launcher` as a compatibility command
- launcher runtime execution should not be pulled fully in-process into `robotick-hub` during Pre-MVP; the current launcher listener owns process handles, queues, threads, websocket log fan-out, and singleton runtime status, so hub should initially own it as a managed capability/worker rather than importing arbitrary route internals
- Studio is a UI client of `robotick-hub`; it should not start, stop, supervise, or directly own launcher services
- future non-CLI clients should speak to `robotick-hub` or the same hub-backed command contracts, not to separate privileged control paths

The first proportional shape should be closer to:

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

Where:

- `robotick_cli/__main__.py` wires the CLI together and stays small
- `robotick_cli/language/` owns the Robotick command language: parsing, routing, context rules, and help shape
- `robotick_cli/interfaces/` contains ways of using that language, such as argv one-shot mode and the immediate shell
- `robotick_cli/hub_client.py` ensures/discovers `robotick-hub` when a command needs hub-backed state, then calls the hub API
- `robotick_hub/app.py` creates the FastAPI app and composes routers/capabilities
- `robotick_hub/contracts/` owns Pydantic request/response models shared by hub routes, tests, CLI rendering, and later future clients
- `robotick_hub/api/` owns HTTP routes and should stay thin
- `robotick_hub/capabilities/` owns orchestration of first-party capabilities such as launcher, Studio, and workspace
- `robotick_hub/runtime/` owns local service/process mechanics such as `.robotick/instances`, workspace service registration, process-tree shutdown, and port allocation

This creates visible architectural boundaries without pretending the tools are already large frameworks. The folders are allowed to start with one or two files each. Further subdivision should be demand-led: for example, `robotick_hub/capabilities/studio/capture/` should appear only once capture has enough behavior and tests to justify its own folder.

Recommended hub ownership model:

- `robotick-hub` is the only long-running local Robotick control service
- `robotick-cli` provisions or discovers `robotick-hub`, then uses the hub API
- Studio receives the hub endpoint and talks to `robotick-hub`, not to `robotick-cli`
- `robotick-hub` composes first-party capabilities through explicit service/library contracts
- `robotick-hub` owns provisioning and lifecycle policy for local workspace services
- capabilities own their domain behavior and expose small stable APIs to the hub
- launcher is a first-party capability, not a special case because it is Python
- `robotick-launcher` should expose stable library/service functions such as ensure, status, stop, endpoint discovery, and run-state mapping; `robotick-hub` should not import arbitrary deep launcher internals
- `robotick-hub` may embed simple capabilities such as workspace/project query behavior directly at first
- `robotick-hub` may provision managed services, such as a launcher runtime worker/service, and discover external services, such as already-open Studio instances
- one-shot commands and immediate-mode commands should both use the same hub-backed service provisioning rules
- shared query truth such as workspace project listing should live at hub/workspace scope rather than only under the Studio namespace; Studio may expose convenience aliases, but it should not be the sole route to those answers
- when `robotick-hub` is running in a desktop session, it should present a system tray presence as part of the same tool/process rather than acting like a purely hidden background service
- headless environments are the exception: `robotick-hub` may run without tray presence when no desktop session is available

Recommended hub service policy:

- commands that need hub-backed state call `ensure_hub()` before doing work
- entering the immediate `robotick` shell should eagerly ensure `robotick-hub` so the operator immediately gets visible hub/tray presence in desktop environments
- service-backed capabilities are Robotick-workspace-scoped and can outlive a single `robotick` CLI process
- one `robotick-hub` should exist per Robotick workspace at a time; the hub runtime should therefore own a Robotick-workspace-scoped singleton lock rather than relying on a discovery record alone
- hub reuse should require both liveness and compatibility; a healthy-but-old hub must be restarted if its declared hub contract version does not match what the current CLI expects
- commands such as `--help` should not start the hub or other background services; shared workspace/project query paths should route through the hub once available
- `robotick studio open` should ensure `robotick-hub`, ask it to ensure required capabilities, then open/register the Studio instance with the hub endpoint
- launcher shutdown should be explicit through Robotick commands such as `robotick launcher stop` or future broader service commands
- Studio quit should close Studio only; it should not stop or supervise launcher processes
- in desktop environments, hub start should also establish tray presence so operators can see that Robotick is active and stop the hub intentionally when appropriate
- the same compatibility rule should apply to managed capabilities such as launcher: hub should reuse only a healthy, contract-compatible launcher service, and should relaunch any stale or incompatible launcher automatically

Initial hub contract:

- `GET /v1/health`
  report hub liveness, Robotick workspace identity, and machine-checkable contract metadata such as `api_contract_version` and `build_id`
- `GET /v1/capabilities`
  list embedded, managed, and discovered capabilities plus health/endpoint summaries
- `GET /v1/workspace/projects`
  list registered workspace projects without requiring launcher runtime state
- `GET /v1/studio/projects`
  return the same workspace project list in Studio-facing shape, plus current target-project metadata when a Studio instance is bound
- `POST /v1/capabilities/launcher/ensure`
  ensure the launcher capability is available when a command needs it
- `GET /v1/launcher/status`
  report launcher runtime state through the launcher capability
- `POST /v1/studio/open`
  open/register a Studio instance with the hub endpoint configured
- `GET /v1/studio/instances`
  list known Studio instances
- `POST /v1/studio/instances/{id}/quit`
  request graceful Studio quit for a known instance

Capability acquisition policy:

- embedded capabilities live inside `robotick-hub`, for example simple workspace/project queries at first
- managed capabilities are started/stopped by `robotick-hub`, for example launcher runtime execution when a command needs it
- discovered capabilities are registered or observed by `robotick-hub`, for example already-open Studio instances
- each capability should expose a small typed contract: id, kind, health, endpoint if any, and supported operations
- Pydantic models define these contracts once so hub routes, CLI rendering, Studio clients, tests, and later future clients agree on the same shapes
- long-running managed capabilities should also expose explicit compatibility metadata so the immediate supervisor can decide reuse versus restart without relying on accidental endpoint failures

Recommended Studio instance model:

- each running Studio instance advertises a stable instance id
- each instance registration includes process id, selected target-project if any, control endpoint, and app lifecycle state
- opening Studio without a project means `selected_target_project = null`, not an implicit fake default project
- Studio should always be able to show the full workspace project list from `robotick-hub`, whether it opened blank or with a preselected project
- MVP registry can be a workspace-local runtime directory, for example `.robotick/instances/`
- each instance should write and remove its own registration record
- instance discovery should be registry-backed but reconciled against live process-group and, when available, control-endpoint truth rather than trusting either source alone
- reconciled instance state should classify entries such as `running`, `degraded`, `stale`, and `gone`

Recommended launcher capability model:

- one `robotick-hub` exists per Robotick workspace
- launcher is a Robotick-workspace-scoped capability/service, not a singleton bound to one Studio instance or one project
- launcher reuse should be compatibility-checked by hub, not by Studio; an old but still live launcher must be stopped and relaunched when its declared launcher contract no longer matches the hub expectation
- launcher should support many runs beneath that service, each with its own run id, target project, profile, status, and optional owning Studio instance id
- Studio target-project state and launcher run identity are separate concepts; switching Studio target project should not silently redefine launcher service identity
- if concurrent runs need to stay constrained in early MVP, constrain them with explicit rules such as one active run per `(project, profile)` rather than a hidden global singleton
- the current launcher listener shape should be treated as a compatibility/service adapter, not the desired internal architecture: route modules should become thin wrappers over explicit launcher services, and runtime state should move into a run registry rather than module globals

Recommended launcher integration staging:

- Pre-MVP: `robotick-hub` owns launcher lifecycle as a managed capability/worker. It may embed safe query-only behavior such as workspace/project/model discovery when that code is cleanly exposed, but build/run/stop execution should remain isolated behind a launcher process or worker contract.
- MVP: hub, CLI, Studio, and launcher agree on typed Pydantic contracts for capability health, compatibility/version metadata, run creation, run status, readiness, stop, logs/events, and failure detail. Runtime state is keyed by explicit run ids, with early concurrency limits stated as policy rather than emerging from singleton globals.
- Future work: after launcher routes are thin adapters over explicit service objects, decide capability-by-capability whether to embed more launcher logic in-process. Query and validation capabilities are good candidates; actual model/runtime execution may remain process-backed indefinitely for crash isolation and process-tree cleanup.

Recommended transport:

- use `robotick-hub` as the explicit local control-plane endpoint
- prefer localhost HTTP/JSON for MVP request/response commands, backed by FastAPI/Pydantic contracts
- add WebSocket later for event streams if needed
- hub API owns capability discovery, health, workspace status, service provisioning, and cross-capability status
- launcher capability API owns model/runtime launch, stop, status, and readiness
- Studio capability API owns instance, window, Studio workbench, layout tab, panel/editor, viewer readiness, capture, focus, and quit state

Future clients should wrap this same surface. They should not have stronger powers or separate privileged behavior.

### MVP Capability And State Contract

This section is the MVP contract definition. It is intentionally concrete enough that CLI, hub, Studio, and launcher implementations should converge on the same resource model and state semantics.

Terminology:

- `robotick_workspace`
  the repository/workspace checkout containing `robotick.yaml`
- `studio_workbench`
  Studio's own route/workbench concept, such as `remote-control`, `telemetry`, `models`, or a future per-window custom workbench
- `workspace_id`
  should be avoided in contracts unless the surrounding resource makes the namespace unambiguous; prefer `robotick_workspace_id` or `studio_workbench_id`

MVP does not need to expose every Studio workbench operation. It does need to avoid a shape that only works for one route, one panel, and one primary window. It is acceptable for early commands to target the active primary window, active Studio workbench, active layout tab, or a named panel; the resource model should still make room for secondary windows, per-window custom Studio workbenches, multiple layout tabs, docked panels, floating panels, and direct data-source queries.

Canonical resource types:

- `robotick_workspace`
  checkout-scoped identity and project registration truth
- `hub_capability`
  a capability exposed by `robotick-hub`, whether embedded, managed, or discovered
- `studio_instance`
  one open Studio app instance known to the hub
- `studio_window`
  one Electron window within a Studio instance
- `studio_project_binding`
  the current target-project selection for a specific Studio instance
- `studio_workbench`
  one Studio workbench surface available in a specific window or window template
- `studio_layout_tab`
  one saved layout tab inside a Studio workbench for a specific window
- `studio_panel`
  one docked or floating panel instance hosting an editor
- `studio_editor`
  one registered editor/tool that can be hosted in a panel
- `launcher_service`
  the Robotick-workspace-scoped launcher capability/service
- `launcher_run`
  one runtime launch attempt or active runtime beneath the launcher service
- `data_source_target`
  a direct query target such as a telemetry stream, launcher status endpoint, model registry, or project model descriptor that may be used without reading panel UI
- `viewer_state`
  the state of a specific viewer or view-like target, whether derived from a panel, a viewer engine, or a direct data source
- `capture_result`
  the result of one capture operation, including output metadata and trustworthiness
- `shutdown_state`
  the current staged shutdown state for an app or service being asked to stop

Canonical id rules:

- all canonical ids are opaque strings, not integers
- ids are stable for the lifetime of the resource they identify
- display labels may mirror canonical ids during MVP, but callers must treat ids as opaque
- `robotick_workspace_id` is stable for the workspace checkout and should include a machine-usable root path plus a stable workspace id
- `studio_instance_id` is Robotick-workspace-scoped and remains stable until that Studio instance is gone
- `studio_window_id` is scoped to a Studio instance and maps to the Electron `windowScope`
- `studio_workbench_id` is scoped to a Studio window; built-in ids such as `remote-control` remain stable, and future custom per-window workbench ids must be opaque
- `layout_tab_id` is scoped to `(studio_window_id, studio_workbench_id)`
- `panel_id` is scoped to `(studio_window_id, studio_workbench_id, layout_tab_id, surface_kind)`
- `editor_id` is a registered editor id, not a panel id
- `launcher_service_id` is Robotick-workspace-scoped and stable across launcher restarts only if the same logical launcher service is being supervised
- `launcher_run_id` is unique within a Robotick workspace and never reused
- project names such as `barr-e` are canonical project ids for MVP

Required common fields:

- every resource response must include `resource_type`
- every resource response must include its canonical `id`
- every long-lived resource must include `state`
- every machine-generated timestamp should be RFC 3339 UTC
- every resource may include `display_name` for human rendering, but callers must not key logic on it
- every degraded or failed state must carry machine-readable reason data rather than prose-only explanation
- Studio context fields such as `studio_window_id`, `studio_workbench_id`, `layout_tab_id`, and `panel_id` may be `null` when an operation intentionally targets a direct data source rather than visible Studio UI

Capability contract shape:

- `hub_capability`
  fields: `id`, `kind`, `source`, `state`, `api_contract_version`, `build_id`, `endpoint`, `supported_operations`, `last_seen_at`, `health`
- `kind`
  enum: `robotick_workspace`, `studio`, `launcher`, future capability ids later
- `source`
  enum: `embedded`, `managed`, `discovered`
- `state`
  enum: `unavailable`, `starting`, `ready`, `degraded`, `stopping`, `stopped`, `failed`, `stale`

Robotick workspace contract shape:

- `robotick_workspace`
  fields: `id`, `root_path`, `schema_version`, `studio_default_path`, `studio_default_mode`, `projects`
- `projects`
  array of `{ id, project_dir, display_name }`

Studio contract shape:

- `studio_instance`
  fields: `id`, `state`, `mode`, `pid`, `process_group_id`, `started_at`, `last_seen_at`, `selected_target_project_id`, `control_endpoint`, `registration_source`, `app_version`, `build_id`, `windows`
- `state`
  enum: `launch_requested`, `launching`, `running`, `degraded`, `quitting`, `stopped`, `gone`, `stale`, `failed`
- `registration_source`
  enum: `hub_open`, `self_register`, `discovered`
- `studio_window`
  fields: `id`, `studio_instance_id`, `scope`, `is_primary`, `state`, `current_studio_workbench_id`, `available_studio_workbenches`, `active_child_window_scopes`, `bounds`, `is_visible`, `is_focused`, `last_seen_at`
- `state`
  enum: `opening`, `visible`, `hidden`, `focused`, `unfocused`, `closing`, `closed`, `stale`, `failed`
- `studio_project_binding`
  fields: `studio_instance_id`, `project_id`, `bound_at`
  `project_id` may be `null`
- `studio_workbench`
  fields: `id`, `studio_window_id`, `path`, `label`, `group`, `default_editor_id`, `allowed_editor_ids`, `source`, `state`
- `source`
  enum: `builtin`, `project`, `user`, `session`
- `state`
  enum: `available`, `active`, `hidden`, `removed`, `failed`
- `studio_layout_tab`
  fields: `id`, `studio_window_id`, `studio_workbench_id`, `name`, `state`, `panel_tree_root_id`, `panel_ids`, `floating_panel_ids`
- `state`
  enum: `available`, `active`, `closing`, `closed`, `stale`
- `studio_panel`
  fields: `id`, `studio_window_id`, `studio_workbench_id`, `layout_tab_id`, `surface_kind`, `editor_id`, `title`, `state`, `settings`, `bounds`, `parent_panel_id`
- `surface_kind`
  enum: `docked`, `floating`
- `state`
  enum: `loading`, `ready`, `degraded`, `failed`, `closed`, `stale`
- `studio_editor`
  fields: `id`, `label`, `source`, `plugin_id`, `supported_observations`, `supported_captures`

Launcher contract shape:

- `launcher_service`
  fields: `id`, `state`, `api_contract_version`, `build_id`, `endpoint`, `pid`, `started_at`, `last_seen_at`, `supported_profiles`, `health`
- `state`
  enum: `unavailable`, `starting`, `ready`, `degraded`, `stopping`, `stopped`, `failed`, `stale`
- `launcher_run`
  fields: `id`, `state`, `project_id`, `profile_id`, `owner_studio_instance_id`, `created_at`, `started_at`, `stopped_at`, `exit_code`, `failure`, `runtime_readiness`, `active_studio_workbench_id`, `active_viewer_id`
- `state`
  enum: `launch_requested`, `launching`, `running`, `healthy`, `degraded`, `failed`, `stopping`, `stopped`
- `owner_studio_instance_id`
  may be `null`

Data-source, viewer, and capture contract shape:

- `data_source_target`
  fields: `id`, `kind`, `project_id`, `launcher_run_id`, `model_id`, `endpoint`, `state`, `readiness`, `latest_metrics`
- `kind`
  enum: `telemetry_stream`, `launcher_status`, `project_models`, `workload_registry`, `viewer_engine`
- `state`
  enum: `unknown`, `available`, `streaming`, `degraded`, `failed`, `stale`

- `viewer_state`
  fields: `id`, `studio_instance_id`, `studio_window_id`, `studio_workbench_id`, `layout_tab_id`, `panel_id`, `surface_kind`, `editor_id`, `viewer_id`, `observation_source`, `data_source_target_id`, `state`, `view_readiness`, `latest_metrics`, `last_frame_at`, `degraded_reasons`
- `observation_source`
  enum: `panel`, `viewer_engine`, `telemetry_data_source`, `launcher_service`
- `state`
  enum: `unknown`, `inactive`, `selected`, `streaming`, `degraded`, `failed`, `stale`
- `capture_result`
  fields: `id`, `studio_instance_id`, `studio_window_id`, `project_id`, `launcher_run_id`, `studio_workbench_id`, `layout_tab_id`, `panel_id`, `surface_kind`, `editor_id`, `viewer_id`, `data_source_target_id`, `capture_target_kind`, `captured_at`, `output_path`, `state`, `capture_readiness`, `runtime_readiness_summary`, `viewer_readiness_summary`, `failure`
- `capture_target_kind`
  enum: `panel`, `viewer`, `telemetry_snapshot`, `launcher_status`, `diagnostics`
- `state`
  enum: `capture_requested`, `capturing`, `captured`, `degraded`, `failed`

Shutdown contract shape:

- `shutdown_state`
  fields: `id`, `target_resource_type`, `target_resource_id`, `state`, `started_at`, `finished_at`, `blocking_conditions`, `timeout_at`, `failure`
- `state`
  enum: `shutdown_requested`, `quitting`, `draining`, `stopped`, `timed_out`, `failed`

Readiness contract shape:

- readiness payloads are not bare booleans
- readiness payloads must include `readiness_class`, `status`, `checked_at`, `reasons`, `evidence`
- `readiness_class`
  enum: `launcher_capability`, `launcher_run`, `studio_workbench`, `studio_panel`, `data_source`, `viewer`, `capture`
- `status`
  enum: `unknown`, `not_ready`, `ready`, `degraded`, `failed`
- `reasons`
  array of machine-readable reason objects
- reason object fields: `code`, `scope`, `message`, `retryable`, `details`
- `scope`
  enum: `robotick_workspace`, `studio_instance`, `studio_window`, `studio_workbench`, `studio_layout_tab`, `studio_panel`, `launcher_service`, `launcher_run`, `data_source`, `viewer`, `capture`, `shutdown`

Minimum readiness evidence:

- launcher capability readiness evidence should include compatibility status and endpoint liveness
- launcher run readiness evidence should include required-model health, telemetry read/write availability, and critical runtime failures
- Studio workbench readiness evidence should include the Studio instance, window scope, available workbench ids, active workbench id, and whether the requested workbench exists, is active, hidden, removed, or failed
- Studio panel readiness evidence should include window/workbench/layout-tab identity, docked or floating surface kind, panel id, editor id, and panel loading/degraded/stale state
- viewer readiness evidence should include selected Studio window/workbench/layout/panel identity when panel-derived, plus receive/present or equivalent freshness signals
- direct data-source readiness evidence should include endpoint liveness, schema/session freshness, and latest sample or status freshness without requiring a panel to exist
- capture readiness evidence should include placeholder/non-placeholder truth and whether the panel, viewer, or data-source target has produced enough recent trustworthy data to capture

Failure contract shape:

- all failed or degraded resources should use a shared failure object where relevant
- failure object fields: `code`, `message`, `retryable`, `scope`, `related_resource_ids`, `details`, `observed_at`
- codes must be stable strings such as `launcher_contract_mismatch`, `model_exit_nonzero`, `viewer_no_frames`, `capture_target_placeholder`, `shutdown_timeout`
- human-readable `message` is secondary; callers should key behavior from `code`, `scope`, and `retryable`

Compatibility policy:

- `api_contract_version` is the compatibility gate for hub-managed reuse
- `build_id` identifies the concrete implementation build for diagnostics, not compatibility by itself
- hub reuse requires matching Robotick workspace identity, liveness, singleton lock ownership, and compatible `api_contract_version`
- launcher reuse requires the same, plus compatibility with the hub's expected launcher contract version
- a healthy-but-incompatible hub or launcher must be restarted rather than reused
- incompatibility must surface as explicit supervised state and failure code, not only as an endpoint error

Concurrency policy for MVP:

- one hub per Robotick workspace
- one launcher service per Robotick workspace
- multiple Studio instances may exist per Robotick workspace
- multiple Studio windows may exist per Studio instance
- Studio workbenches may become per-window and user/custom configurable before or during MVP hardening; contracts must therefore discover them from the Studio instance/window rather than assuming a fixed global list
- early launcher concurrency may be constrained to one active run per `(project_id, profile_id)`
- any MVP concurrency constraint must be enforced as explicit policy with a stable failure code, not as accidental singleton behavior

Operation semantics:

- operations that cause work to begin should acknowledge quickly with the target resource in its initial state
- `studio open` returns a `studio_instance` in `launch_requested` or `launching`
- `launcher launch` returns a `launcher_run` in `launch_requested` or `launching`
- wait commands do not create new resources; they poll or subscribe to state changes on an existing target id
- stop and quit commands transition existing resources toward `stopping`, `quitting`, or `shutdown_requested`; they do not silently target unrelated global state
- `--wait` behavior may block at the CLI layer, but the underlying contract must still expose the intermediate resource state
- panel-oriented operations target Studio resources such as `studio_window_id`, `studio_workbench_id`, `layout_tab_id`, and `panel_id`
- direct operations may target `data_source_target_id`, `launcher_run_id`, or model/telemetry ids without requiring any visible panel

Normative state transitions:

- `studio_instance`
  `launch_requested -> launching -> running`
  `running -> degraded|quitting|failed`
  `degraded -> running|quitting|failed`
  `quitting -> stopped|gone|failed`
  `stopped|gone|failed` are terminal for that instance id
- `studio_window`
  `opening -> visible|focused`
  `visible -> focused|unfocused|closing|failed`
  `focused -> visible|unfocused|closing|failed`
  `closing -> closed|failed`
- `studio_panel`
  `loading -> ready|degraded|failed`
  `ready -> degraded|closed|failed`
  `degraded -> ready|closed|failed`
  `closed|failed` are terminal for that panel id
- `launcher_service`
  `unavailable -> starting -> ready`
  `ready -> degraded|stopping|failed`
  `degraded -> ready|stopping|failed`
  `stopping -> stopped|failed`
- `launcher_run`
  `launch_requested -> launching -> running|healthy|degraded|failed`
  `running -> healthy|degraded|stopping|failed`
  `healthy -> degraded|stopping|failed`
  `degraded -> healthy|stopping|failed`
  `stopping -> stopped|failed`
- `capture_result`
  `capture_requested -> capturing -> captured|degraded|failed`
- `shutdown_state`
  `shutdown_requested -> quitting -> draining -> stopped`
  timeout or unrecoverable error moves to `timed_out` or `failed`

CLI-to-contract mapping rules:

- one-shot CLI commands should render contract resources, not invent extra hidden state
- immediate-mode shell commands should use the same underlying operations and resources as one-shot commands
- shell binding is a CLI convenience over canonical ids, not a second resource model
- JSON output should serialize the underlying contract resource or operation result with minimal presentation wrapping

### Readiness Model

Do not collapse readiness into one boolean. The Barr.e baseline failure happened because a UI-level heuristic was treated as operational truth. MVP should use explicit readiness classes and require callers to name the class they are waiting for when ambiguity matters.

Launcher capability readiness answers:

- is the Robotick-workspace-scoped launcher service available?
- is it contract-compatible with the current hub?
- can it accept run lifecycle commands?

Launcher run readiness answers:

- is the requested robot/model stack up for a specific run id?
- are required models running?
- are required models healthy?
- is telemetry read/write available?
- are there critical runtime failures?

Studio workbench/viewer readiness answers:

- is the requested Studio instance alive and bound to the intended project?
- is the requested Studio window available?
- is the requested Studio workbench active in that window?
- is the requested layout tab active when panel state matters?
- is the requested panel/editor present when panel state matters?
- is the selected viewer option known?
- are frames or telemetry arriving where relevant?
- is the view degraded by upstream runtime failures?

Capture readiness answers:

- is the requested capture target present and measurable?
- has the target produced enough recent non-placeholder data to be trustworthy?
- does the capture metadata include runtime and viewer readiness summaries?
- should capture proceed, wait, or fail with a machine-readable reason?

Remote Control readiness is a Studio workbench/viewer readiness projection over launcher-run truth plus view-specific receive/present signals. It is not a separate definition of robot readiness, and launcher-run readiness alone is not enough to prove an RC screenshot or panel capture will be meaningful.

### Capture And Shutdown

Capture should be a first-class operation, not a screenshot improvised through UI automation.

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
- model/runtime readiness summary
- Studio workbench/viewer readiness summary
- capture target kind

Shutdown should be staged:

1. renderer enters `quitting`
2. reconnecting clients stop reconnecting
3. websocket/log tasks drain or are cancelled
4. app reports `quit_complete`

Launcher shutdown is a separate Robotick lifecycle operation, not part of Studio quit.

The hub and CLI should expose shutdown blockers rather than leaving the user at `CTRL+C to force quit`.

### Out Of Scope

MVP does not design or implement an MCP surface.

The requirement for MVP is narrower:

- define a stable local operational contract in `robotick-hub`
- make CLI and Studio speak that contract consistently
- keep the contract typed and machine-usable enough that future clients can wrap it cleanly

MCP is future work. When it arrives, it should wrap the same hub-backed operational truth rather than introducing privileged behavior, parallel state semantics, or a second control plane.

## Implementation Plan

### Phase 0: Hello-World Slice

Goal: validate naming, folder structure, manifest shape, docs, and launch delegation before deeper Studio control work begins.

- [x] Added root `robotick.yaml`
      Deliverable: default Studio path/mode, registered projects, and per-project launch entrypoints are now defined in the workspace manifest.

- [x] Made the normal launch path obvious
      Deliverable: `README.md` now documents the canonical human `robotick studio ...` flow, and `AGENTS.md` provides a short bot/operator supplement.

- [x] Added initial CLI structure
      Deliverable: `robotick/robotick-studio/tools/robotick-cli/`, a quiet `./tools/robotick` workspace shim, an installable `robotick` front-door shim, a simple `robotick>` immediate mode with one-level namespace context, and a TypeScript/Node implementation are now in place without visible `npm`/`node` noise in normal use.

- [x] Added first commands
      Deliverable: `robotick studio projects`, `robotick studio create`, `robotick studio open`, and the current compatibility shortcut `robotick studio open <project>` now read `robotick.yaml`; empty and project-targeted Studio opens both go through the shared Studio runner, with project selection carried as Robotick context rather than via separate per-project launch stacks.

- [x] Added immediate-mode Studio open path
      Deliverable: inside `robotick:studio>`, `create` now launches empty Studio without binding, `open` creates and immediately binds to the new instance, and the current compatibility shortcut `open <project>` creates and enters a registered project directly.

### Pre-MVP: Open/Close UX

Goal: make `robotick studio open ...` and the eventual Studio close path feel like Robotick commands rather than raw dev-script passthrough.

- [x] Reduced launch spam
      Deliverable: `robotick studio open <project>` now reports concise Robotick-level progress by default rather than dumping full `npm` / `vite` / Electron output immediately.

- [x] Made log attachment intentional
      Deliverable: normal open flows now stay quiet by default, and `robotick studio open <project> --attach` is available for power-users who want the full Studio log stream.

- [x] Surface Studio-level success
      Deliverable: `open` now reports a Robotick-level result including Studio launch start, log location, and a provisional instance identity instead of only inheriting child-process lifetime.

- [x] Established the initial action-like `open` behavior
      Deliverable: the first quiet launch flow kept the shell at `robotick:studio>`, reported an instance folder such as `studio-12345/`, and left navigation to `cd studio-12345`. This was later superseded by the explicit `create` primitive plus `open` composite, where immediate-mode `open` may bind to the new instance while one-shot `open` returns a targetable instance identity.

- [x] Made `back` follow shell pathing
      Deliverable: `back` now unwinds one level at a time, so an instance-bound prompt returns to `robotick:studio>`, then `robotick>`.

- [x] Started presenting context like a path
      Deliverable: the shell now treats context-forming entries more like directories, especially in `ls`, so namespace/scope changes are easier to distinguish from executable actions.

Checklist housekeeping rule:

- when a checklist item is completed, tick it, rewrite the deliverable/test-scope wording into past tense or completed wording, and add a brief summary of the work now in place

- [x] Clarified strict `studio` context semantics
      Deliverable: the design now says plain `studio` exposes `open` as an action rather than a context; project context is deferred until it is genuinely bound inside an already open Studio instance.

- [x] Migrated shell implementation to instance folders
      Deliverable: after `open` succeeds, the shell stays at `robotick:studio>`, reports the new instance folder such as `studio-12345/`, `ls` presents that folder as an enterable context, and tests cover the new folder/file contract.

- [x] Separated shell exit from Studio quit
      Deliverable: the design now treats `exit` as leaving the Robotick CLI, `back` as moving to the parent shell context, and `quit` as closing the currently bound Studio instance.

- [x] Started catch-up CLI contract tests
      Deliverable: automated CLI tests now cover current shell/path behavior, including `ls` context/action presentation, quiet empty/project open flows, `instances`, `cd` into discovered instance folders, `back` unwinding, clean `quit`, and stale-instance cleanup.

- [x] Clear stale instance context after Studio closes
      Deliverable: when a bound Studio instance exits, the shell drops from `robotick:studio:studio-12345>` back to `robotick:studio>`, removes the stale `studio-12345/` context from `ls`, prints a short notice, and does not leave stale bound context behind.

- [x] Remove fixed-port footguns from repeated dev launches
      Deliverable: repeated `open` calls no longer collide on a hard-coded Electron devtools port, and the dev-mode launch path now allocates a per-launch remote-debugging port.

- [x] Improve close/shutdown ergonomics before full lifecycle work
      Deliverable: `quit` now targets the detached Studio process group rather than only the wrapper pid, gives a concise Robotick-level close result, waits briefly for clean process-group exit, clears the instance folder on success, and surfaces incomplete shutdown as a quiet, explicit message instead of raw child-process spam.

- [x] Split create from open and make open the first composite command
      Deliverable: `create` is now the primitive instance-creation command that reports the new `studio-12345/` folder without changing context, while `open` is now the convenience composite that creates an instance and immediately binds to it in the immediate shell.

- [x] Established the Python CLI language and hub client slice
      Deliverable: the hello-world TypeScript CLI has been replaced with a Python Robotick operations CLI, one-shot argv mode and immediate shell mode now use the same Robotick language/routing layer, hub-backed commands go through a small `hub_client` that can ensure/discover `robotick-hub`, and command/help/shell-discovery output now comes from a shared command registry rather than hand-maintained strings.
      Test scope: parse/route tests, command-registry/help generation tests, argv vs immediate-mode equivalence tests, and tests proving help/project-listing paths do not start hub-backed services now pass.

- [x] Added the hello-world `robotick-hub` slice
      Deliverable: `tools/robotick-hub/` now exists as a Python/FastAPI/Pydantic service with health, capability listing, Robotick workspace identity, service-registry-backed hub record management, workspace project listing, Studio-facing project-list metadata, and a first end-to-end CLI command path through `robotick hub status` and `robotick hub projects`.
      Test scope: FastAPI contract tests for health/capabilities/Robotick workspace identity/project-list endpoints, service-registry record tests, real CLI-to-hub startup/status/projects tests, and workspace-shim smoke checks now pass.
      Summary of work done: added the new `tools/robotick-hub/` package, taught `robotick-cli` to bootstrap and query the hub, exposed a minimal `hub/` namespace in one-shot and immediate modes, and kept the slice proportional by limiting it to health/capabilities/projects rather than prematurely routing launcher or Studio control through the hub.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [x] Added desktop tray presence to `robotick-hub`
      Deliverable: when `robotick-hub` runs in a desktop session it now exposes a Robotick tray icon within the same tool/process, uses a bundled local copy of the Robotick icon from `https://robotick.org/images/icon.png`, surfaces lightweight hub state, and provides safe actions such as opening Studio, viewing status, and stopping the hub; headless environments continue without tray presence.
      Test scope: desktop-session detection tests, tray bootstrap/fallback tests, CLI smoke tests covering headless and desktop-backed startup, and hub lifecycle tests proving tray failure handling does not break headless service operation now pass.
      Summary of work done: kept `robotick-hub` in Python, added a small PyQt5 tray layer inside the same process, taught hub bootstrap to fall back to a Python interpreter with Qt support when needed, vendored the Robotick icon into the hub source tree for local use, and preserved headless service behavior as the non-desktop fallback.
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5` / `medium` if desktop integration details become the main challenge

- [x] Routed launcher capability through hub
      Deliverable: `robotick-launcher` now sits behind a small hub-owned provider contract for ensure, status, stop, endpoint discovery, and run-oriented listener state; `robotick-hub` owns launcher lifecycle as a managed capability/worker rather than importing launcher route modules directly; launcher is modelled as a workspace capability with runs beneath it rather than as a hidden single-project singleton; and `robotick launcher status` plus the launcher ensure path now operate through the hub.
      Test scope: fake launcher provider tests, idempotent ensure tests, managed-worker lifecycle tests, run/status mapping tests, hub route tests, and real CLI-to-hub-to-launcher status smoke tests now pass.
      Summary of work done: added a dedicated `robotick_hub.launcher` provider that starts and tracks the launcher listener as a managed subprocess, records its endpoint/PID under `.robotick/launcher.json`, exposes `POST /v1/capabilities/launcher/ensure`, `GET /v1/launcher/status`, and `POST /v1/launcher/stop`, makes launcher capability state visible in `hub status`, and adds the first routed `robotick launcher status` CLI slice including immediate-shell access from other contexts.
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5` / `medium` if the integration seam gets tangled

- [x] Moved shared workspace/project queries onto hub-backed paths
      Deliverable: project discovery is no longer Studio-only; canonical shared query paths such as `robotick hub projects` now answer from the hub, `robotick studio projects` now acts as a convenience wrapper over the same hub-backed truth rather than a direct manifest-only special case, and entering the immediate `robotick` shell eagerly ensures the hub.
      Test scope: CLI tests now prove shared and Studio convenience query paths return the same hub-backed project list, immediate-shell startup eagerly ensures the hub, and `--help` remains side-effect free.
      Summary of work done: routed Studio project listing through the hub-backed workspace projects endpoint, preserved the existing `studio projects` UX while moving its source of truth, and changed immediate shell startup to ensure the hub up front so normal CLI entry now creates visible hub/tray presence when appropriate.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [x] Opened Studio through hub and removed Studio-owned launcher lifecycle
      Deliverable: `robotick studio open` now ensures `robotick-hub`, asks hub to ensure required capabilities, opens/registers Studio through new hub-owned Studio endpoints, opens blank with the real workspace project list when no project is specified, opens with the same list plus a preselected target when a project is specified, and Studio no longer starts, stops, supervises, or force-kills launcher processes during its own boot/shutdown path.
      Test scope: CLI-to-hub open tests, hub Studio registration/open tests, provider tests for hub-owned Studio launch/recording, and targeted Studio/Electron bootstrap tests proving launcher spawn/stop hooks are gone now pass.
      Summary of work done: added hub-owned `studio open`, `studio instances`, and `studio quit` endpoints plus a managed instance registry, routed the CLI quiet open path through those endpoints, ensured launcher through hub before Studio launch, removed launcher kill hooks from the Studio shell scripts, removed launcher-manager usage from Electron bootstrap shutdown/startup, and stopped exporting launcher-specific startup hints from the shared Studio launcher scripts.
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5 XL` only if architectural reasoning starts dominating implementation

- [x] Finished Studio quit and instance polish on the hub path
      Deliverable: `quit` now prefers the future Studio control API slot when available and falls back clearly to process-group shutdown today, updates hub/instance registry state, `ls` and `instances` show lightweight metadata such as current project/mode/launch age, and normal Studio quit no longer stalls on launcher ownership because launcher is outside Studio's process lifecycle.
      Test scope: graceful quit tests, stale-instance cleanup tests, metadata rendering tests, provider tests for quit fallback behavior, and shutdown tests proving Studio quit does not stop launcher capability state now pass.
      Summary of work done: moved one-shot quit onto the hub endpoint, kept bound-shell quit aligned with that same path, taught instance rendering to include running state/mode/project/age, preserved stale-instance cleanup on the registry-backed path, and removed the main cause of launcher-related Studio quit coupling by taking launcher lifecycle out of the Studio bootstrap entirely.
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5 XL` for stubborn shutdown/lifecycle reasoning

- [x] Added a generic app-closing signal path through hub
      Deliverable: hub now exposes a small reusable `app instance closing` signal, Studio uses it as a best-effort shutdown notification, and hub can clear the tracked Studio instance immediately when the UI begins closing rather than waiting only for later prompt-time reconciliation or process sweeps.
      Test scope: hub contract tests for the closing endpoint, provider tests for pid-to-instance matching and instance-name matching, and Electron bootstrap tests proving hub-managed Studio attempts the closing signal during graceful shutdown now pass.
      Summary of work done: added a generic `POST /v1/apps/{app_id}/instances/closing` hub route, taught the hub-side Studio provider to resolve a closing signal from either explicit instance name or member pid within the tracked process group, and wired Electron bootstrap to emit a short best-effort `studio closing` notification before forcing final app exit.
      Recommended Codex model/effort: `gpt-5.4-mini` / `medium`

- [x] Hardened interactive-shell error handling and stale quit fallbacks
      Deliverable: command-level failures in the Robotick immediate shell no longer terminate the shell session; stale bound-instance `quit` requests now fall back to instance reconciliation and context unwind where possible; and unexpected command exceptions degrade to a concise error plus continued shell operation rather than crashing out to the parent terminal.
      Test scope: stale bound-instance quit tests, interactive-shell recovery tests for unexpected command exceptions, and existing CLI shell regression coverage now pass.
      Summary of work done: moved bound-instance `quit` onto an explicit helper with stale-instance fallback behavior, widened the interactive shell's command-processing error trap beyond `CliError`, and kept the shell alive after both expected command failures and unexpected command exceptions.
      Recommended Codex model/effort: `gpt-5.4-mini` / `medium`

#### How It Is Looking For Agentic UX

The current Pre-MVP flow is now coherent enough for controlled agentic use. A fresh shell can discover contexts with `ls`, run `studio open barr-e` from the top level, land directly in `robotick:studio:studio-12345>`, inspect instance-scoped actions with `ls`, run `quit`, and confirm `instances` returns `none`. That gives agents a concrete lifecycle they can follow without rummaging through project scripts: discover workspace projects, open a Studio instance, bind to that instance, act within it, then close it.

The context grammar is also becoming usefully predictable. `studio`, `studio open ...`, `cd studio-12345`, direct `studio-12345`, `back`, `cd ../...`, tab completion, and `Ctrl-C` handling now mostly behave like a small path-oriented shell rather than a pile of ad hoc commands. The simplified project wrappers help too: root and per-robot `run-studio*.sh` scripts remain available for humans, but they are now thin shims over `robotick studio open <project>` rather than a separate launch architecture.

The main agentic risk is no longer command discovery; it is lifecycle truth. Hub-owned reconciliation and explicit `quit` work well, and Studio has a best-effort `I am closing` signal, but manual window-manager close is still not proven reliable enough. We also now know the hub/service singleton story is not finished: multiple `robotick-hub` processes can accumulate for one workspace, and a newer CLI/Studio can bind to an older still-running hub unless compatibility/version ownership becomes formal. Agents should therefore still prefer CLI-owned `quit`, and MVP needs to formalize singleton locking plus compatibility-checked reuse for hub and launcher. The other missing pieces are expected MVP work: readiness state, project switching inside a bound instance, launcher run ids, capture contracts, and richer machine-readable failure details.

### MVP

Goal: make launch -> ready -> snapshot -> stop -> quit obvious, deterministic, and reliable for humans and external automation.

- [x] Defined the MVP Robotick capability/state contract in the design note
      Deliverable: the design now defines canonical MVP resource types, id rules, required fields, state enums, readiness payload shape, failure object shape, compatibility policy, concurrency policy, operation semantics, and normative state transitions for Robotick workspace, hub capability, Studio instance, Studio window, Studio workbench, layout tab, panel/editor, data-source target, launcher service, launcher run, viewer state, capture result, and shutdown state.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Freeze MVP command/result grammar before adding new surface
      Deliverable: one-shot and immediate-mode semantics are documented for `create`, `open`, instance binding, launcher launch results, readiness waits, capture, and stop/quit. In particular, one-shot `studio open` returns a targetable instance identity rather than pretending to change shell context; immediate-mode `open` may bind the prompt to that instance; `launcher launch` returns a run id; `launcher wait-ready` and `launcher stop` accept run ids; and launcher commands invoked from a bound Studio prompt may attach owner-instance metadata without making the launcher service instance-owned.
      Recommended Codex model/effort: `gpt-5.4-mini` / `medium`

- [ ] Enforce Robotick-workspace-scoped hub singleton and compatibility reuse
      Deliverable: one `robotick-hub` exists per Robotick workspace at a time via an explicit runtime lock; CLI `ensure_hub` reuses only a healthy, compatible, lock-owning hub; stale, duplicate, or incompatible hub processes are rejected or restarted deterministically; and `hub status` surfaces enough metadata to explain the active owner.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Implement instance discovery and targeting
      Deliverable: `robotick studio instances`, stable instance folder names, one-shot targeting by instance identity, bound-prompt targeting by current instance, optional targeting flags where still useful, and `ls` support for presenting discovered Studio instances as enterable contexts with reconciled state such as `running`, `degraded`, `stale`, or `gone`.
      Recommended Codex model/effort: `gpt-5.4-mini` / `medium`

- [ ] Implement bound interactive mode
      Deliverable: `robotick studio` opens a REPL that can bind to an instance and run repeated commands without `--instance`.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Implement project switching
      Deliverable: `robotick studio <instance> project <project>` and bound-instance `project ...` flows can bind/switch project state explicitly with clear success/failure reporting; Studio always exposes the full workspace project list from `robotick-hub`; blank-open Studio starts with no selected target project; and preselected-open Studio starts with the same list plus the requested current target.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Continue expanding CLI shell/unit/integration test coverage
      Deliverable: every new command/state permutation is added test-first or test-alongside, including one-shot vs immediate-mode equivalence, quiet vs attached open flows, close/quit lifecycle behavior, future instance discovery/binding, and invalid context/action combinations.
      Recommended Codex model/effort: `gpt-5.4-mini` / `medium`

- [ ] Implement launcher commands
      Deliverable: `robotick launcher launch`, `stop`, `status --json`, and `wait-ready` operate through the hub-owned launcher capability and work consistently in one-shot and immediate-mode forms. `launch` returns a machine-readable run id, `status --json` reports service state plus run state, `wait-ready` can wait on a specific run id and readiness class, and `stop` can stop a specific run without relying on hidden global singleton state.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Enforce launcher compatibility under hub supervision
      Deliverable: launcher exposes explicit compatibility/version metadata through its managed contract; hub reuses only a healthy, compatible launcher for the current workspace; stale, duplicate, or incompatible launcher processes are stopped and relaunched automatically; and version mismatch becomes a first-class supervised state rather than an accidental endpoint failure path.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Implement launcher capability and launcher-run readiness
      Deliverable: machine-readable launcher capability readiness and launcher-run readiness reported through the hub contract rather than inferred from Studio UI state or launcher logs. Run state distinguishes launch requested, launching, running, healthy, degraded, failed, stopping, and stopped; readiness detail includes model health, telemetry read/write availability, critical failures, and stable reasons for timeout/degraded/failure outcomes.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Align implementation and CLI naming on `studio_workbench` / `workbench`
      Deliverable: hub contracts, Studio state/resource names, implementation-facing docs, CLI command grammar, and CLI flags all use `studio_workbench`, `studio_workbench_id`, `workbench`, and `--workbench` for the Studio route/workbench concept, while `robotick_workspace` remains the checkout/runtime-registration concept.
      Recommended Codex model/effort: `gpt-5.4-mini` / `small`

- [ ] Implement Studio workbench/viewer and capture readiness
      Deliverable: Studio reports active window, active/custom Studio workbench, active layout tab, relevant panel/editor identity, selected viewer option, receive/present metrics where relevant, placeholder/non-placeholder state, upstream runtime degradation, and capture-ready/not-ready state. Direct telemetry or launcher-derived readiness paths can bypass panels when the requested truth is not panel-specific. Capture readiness must be distinct from launcher-run readiness so a healthy runtime with a blank or stale RC viewport fails clearly instead of producing a misleading artifact.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Implement first-class capture
      Deliverable: `robotick studio <instance> capture panel ...` writes predictable output plus metadata including timestamp, Studio instance id, Studio window id, selected project, launcher run id if relevant, Studio workbench id, layout tab id when panel-derived, panel/editor id when panel-derived, data-source target id when direct, runtime readiness summary, viewer readiness summary, capture readiness decision, and failure/degraded reasons.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Fix shutdown sequencing
      Deliverable: `robotick studio <instance> quit --wait`, staged shutdown state, blocker diagnostics, and terminal/log reconnect suppression during quit.
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5 XL` if the sequencing/debugging problem proves genuinely hard

- [ ] Make the flow self-describing
      Deliverable: a cold operator or bot can discover the canonical flow from `README.md`, `AGENTS.md`, `robotick.yaml`, and `robotick studio --help`; context listings surface instance state clearly; and visual treatment differentiates enterable contexts from action commands in the same way `ls` already distinguishes folders from non-folder entries.
      Recommended Codex model/effort: `gpt-5.4-mini` / `low`

### Success Criteria

The exact flag names can change during contract review, but the Barr.e baseline should become a flow with explicit instance identity, explicit launcher run identity, and explicit readiness class:

```bash
robotick studio open --json
robotick studio studio-12345 project barr-e
robotick launcher launch --project barr-e --profile local:ALL --owner-instance studio-12345 --json
robotick launcher wait-ready run-67890 --readiness launcher-run
robotick studio studio-12345 wait-ready viewer --workbench remote-control --panel main --run run-67890
robotick studio studio-12345 capture panel --workbench remote-control --panel main --run run-67890 --require capture-ready --out artifacts/...
robotick launcher stop run-67890
robotick studio studio-12345 quit --wait
```

The equivalent interactive flow should work after binding an instance. `open` should bind the prompt to the new instance, and `launcher launch` should print a run id that later commands use explicitly:

```text
robotick studio
open
robotick:studio:studio-12345>
ls
project barr-e
launcher launch --project barr-e --profile local:ALL
launcher wait-ready run-67890 --readiness launcher-run
wait-ready viewer --workbench remote-control --panel main --run run-67890
capture panel --workbench remote-control --panel main --run run-67890 --require capture-ready --out artifacts/...
launcher stop run-67890
quit
```

Future clients should eventually be able to complete the same flow without repo rummaging, script-path discovery, UI selector discovery, visual-state guessing, or log scraping for basic operational truth.

### Future Work

- [ ] Optional OS/session startup for `robotick-hub`
      Deliverable: desktop environments may optionally start `robotick-hub` on login/startup so hub/tray presence exists before the first CLI command, but this remains outside MVP and should not obscure the normal explicit `robotick` bootstrap contract.
      Recommended Codex model/effort: `gpt-5.4-mini` / `low`
- [ ] Refactor launcher internals toward embeddable capability services
      Deliverable: launcher route modules become thin adapters over explicit service objects, runtime state moves out of module globals into a run registry, query/validation services can be imported safely by hub where useful, and runtime execution remains process-backed unless in-process execution becomes clearly justified.
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5 XL` only if broad launcher architecture and concurrency policy dominate the work
- [ ] Artifact/output conventions once capture workflows settle
      Recommended Codex model/effort: `gpt-5.4-mini` / `low`
- [ ] Richer log inspection and tailing commands
      Deliverable: explicit log viewing/tailing commands beyond the current `--attach` launch mode
      Recommended Codex model/effort: `gpt-5.4-mini` / `medium`
- [ ] Richer Studio workbench, viewer, diagnostics, capture, and child-window coverage
      Recommended Codex model/effort: `gpt-5.4` / `medium`
- [ ] MCP adapter over the same operational contract
      Deliverable: an MCP layer exposes selected hub-backed operations as typed tools for agents after the hub, CLI, Studio, launcher, readiness, capture, and shutdown contracts have settled. It must wrap existing operational truth rather than creating privileged behavior or parallel state semantics.
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5 XL` if the cross-contract design work becomes the main challenge
- [ ] Broader telemetry/model inspection commands
      Recommended Codex model/effort: `gpt-5.4` / `medium`
- [ ] Stronger visibility/focus/window-state introspection
      Recommended Codex model/effort: `gpt-5.4` / `medium`
- [ ] Python or other scripting client over the same contract
      Recommended Codex model/effort: `gpt-5.4-mini` / `medium`
