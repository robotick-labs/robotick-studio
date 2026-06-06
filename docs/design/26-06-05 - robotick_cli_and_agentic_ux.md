# Robotick CLI And Agentic UX

Date: 2026-06-05
Baseline project: `robots/barr-e`

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

Build a small, explicit local control plane for Robotick capabilities, then expose it through a human/script CLI, Studio, and later MCP. `robotick-hub` is the local workspace service/API aggregator in that model; Studio and launcher are first-party capabilities exposed through it.

The layers should be:

1. `robotick-hub` local service and capability contract
2. `robotick ...` umbrella CLI as the human/script client
3. workspace project registration and docs
4. Studio and later MCP clients over the same hub contract

Additional scripting clients are out of scope for this phase. They can be added later as other clients of the same operational contract.

Testing should be part of implementation throughout, not deferred to the end. Each supported command/state permutation should be locked down as soon as it is introduced, even if that means catch-up tests while the CLI grammar is still being shaped.

### CLI Shape

Use `robotick` as the umbrella command. `studio` is the Studio namespace; `launcher` is the robot/model lifecycle namespace.

The CLI should follow a path-oriented grammar:

- context-forming commands behave like directories
- action commands behave like executables/files
- the shell prompt is a rendering of the current bound context stack
- `back` pops one level from that stack
- `ls` should present context-forming entries with a directory-like feel, for example `studio/` or `studio-12345/`
- one-shot commands and immediate-mode navigation should describe the same hierarchy, not two different mental models

That metaphor should inform the whole interface:

- `studio` is a context
- `create` is the primitive action that materializes a Studio instance without changing context
- `open` is a composite action over the primitives, initially `create` + `cd`
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
  composite convenience command that creates a new Studio instance and enters it
- `robotick studio <instance>`
  enter or target an existing Studio instance context
- `robotick studio <instance> project ...`
  bind or operate on project state within that instance
- `robotick studio <instance> workspace ...`
  bind or operate on workspace state within that instance
- `robotick studio <instance> viewer ...`
  bind or operate on viewer state within that instance
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

Within that bound prompt, everything should be understood as operating on the currently open Studio instance. In other words, `studio-12345/` is the user-facing hierarchy for “the Studio instance I currently have open”, and the shell should behave as though the user has `cd`'d into that instance.

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
- surface concrete enterable contexts only where they are genuinely bound, such as discovered Studio instances and, later, project/workspace/viewer context within an already open Studio instance
- avoid flattening contexts and actions into one undifferentiated list

Examples:

```bash
robotick studio projects
robotick studio open
robotick studio instances
robotick studio studio-12345 project barr-e
robotick launcher launch --project barr-e --profile local:ALL
robotick launcher wait-ready --project barr-e --workspace remote-control
robotick studio studio-12345 capture panel --workspace remote-control --panel main --out artifacts/...
robotick launcher stop --project barr-e
robotick studio studio-12345 quit --wait
```

Interactive mode should also be supported:

```text
robotick> studio
robotick:studio> projects
robotick:studio> ls
robotick:studio> open
robotick:studio> cd studio-12345
robotick:studio:studio-12345> project barr-e
robotick:studio:studio-12345> launcher launch --project barr-e
robotick:studio:studio-12345> clear
robotick:studio:studio-12345> quit
robotick:studio> back
robotick> exit
```

Command style:

- use path-forming nouns/contexts for scope: `studio`, instance folders such as `studio-12345`, and later `project`, `workspace`, `viewer`
- use action commands within the current scope for work: `launch`, `stop`, `status`, `capture`, `quit`
- keep top-level capability namespaces such as `launcher` available in immediate mode even when the prompt is bound to a Studio instance
- use positional arguments for direct objects: project, workspace, viewer option, panel id
- use flags for context and modifiers: `--instance`, `--profile`, `--workspace`, `--panel`, `--out`, `--timeout`, `--json`

CLI output should be human-readable by default, provide `--json` for status/diagnostics, keep normal output quiet, and use explicit exit codes for invalid args, launch failure, readiness timeout, degraded state, and shutdown timeout.

### Workspace Contract

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
    launch_script: robots/barr-e/run-studio.sh

  pip-e:
    project_dir: robots/pip-e
    launch_script: robots/pip-e/run-studio.sh
```

Do not put readiness policy or artifact policy in this file. A robot/model is ready when the launcher/runtime reports it is alive and ready to read/write telemetry. That is product behavior, not workspace configuration.

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
- current TypeScript/Node CLI implementation is a hello-world slice and should be ported before the CLI grows much more command surface
- normal use should not expose `npm`, `node`, `python`, `pip`, or package-manager details
- a literal root `./robotick` file is not possible in this repo because `robotick/` is already a top-level directory
- an installed `robotick` shim should be able to find the nearest workspace and delegate to its local tool
- the stable user-facing command should be `robotick`; the workspace shim exists only as bootstrap and local fallback

Recommended tool shape:

- `robotick-cli` owns the command language, one-shot argv mode, immediate shell mode, output rendering, and hub client behavior
- `robotick-hub` owns the long-running local workspace API, capability registry, capability orchestration, and service lifecycle policy
- `robotick-launcher` remains a focused launcher capability provider; it should expose stable APIs for hub integration while keeping `robotick-launcher` as a compatibility command
- Studio is a UI client of `robotick-hub`; it should not start, stop, supervise, or directly own launcher services
- MCP should later speak to `robotick-hub` or the same hub-backed command contracts, not to a separate privileged model

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
- `robotick_hub/contracts/` owns Pydantic request/response models shared by hub routes, tests, CLI rendering, and later MCP
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
- `robotick-launcher` should expose stable library/service functions such as ensure, status, stop, and endpoint discovery; `robotick-hub` should not import arbitrary deep launcher internals
- `robotick-hub` may embed simple capabilities such as workspace/project query behavior directly at first
- `robotick-hub` may provision managed services, such as launcher runtime service, and discover external services, such as already-open Studio instances
- one-shot commands and immediate-mode commands should both use the same hub-backed service provisioning rules
- when `robotick-hub` is running in a desktop session, it should present a system tray presence as part of the same tool/process rather than acting like a purely hidden background service
- headless environments are the exception: `robotick-hub` may run without tray presence when no desktop session is available

Recommended hub service policy:

- commands that need hub-backed state call `ensure_hub()` before doing work
- service-backed capabilities are workspace-scoped and can outlive a single `robotick` CLI process
- commands such as `--help`, `projects`, and simple manifest discovery should not start the hub or other background services
- `robotick studio open` should ensure `robotick-hub`, ask it to ensure required capabilities, then open/register the Studio instance with the hub endpoint
- launcher shutdown should be explicit through Robotick commands such as `robotick launcher stop` or future broader service commands
- Studio quit should close Studio only; it should not stop or supervise launcher processes
- in desktop environments, hub start should also establish tray presence so operators can see that Robotick is active and stop the hub intentionally when appropriate

Initial hub contract:

- `GET /v1/health`
  report hub liveness and workspace identity
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
- managed capabilities are started/stopped by `robotick-hub`, for example launcher runtime service when a command needs it
- discovered capabilities are registered or observed by `robotick-hub`, for example already-open Studio instances
- each capability should expose a small typed contract: id, kind, health, endpoint if any, and supported operations
- Pydantic models define these contracts once so hub routes, CLI rendering, Studio clients, tests, and later MCP agree on the same shapes

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

- one `robotick-hub` exists per workspace
- launcher is a workspace-scoped capability/service, not a singleton bound to one Studio instance or one project
- launcher should support many runs beneath that service, each with its own run id, target project, profile, status, and optional owning Studio instance id
- Studio target-project state and launcher run identity are separate concepts; switching Studio target project should not silently redefine launcher service identity
- if concurrent runs need to stay constrained in early MVP, constrain them with explicit rules such as one active run per `(project, profile)` rather than a hidden global singleton

Recommended transport:

- use `robotick-hub` as the explicit local control-plane endpoint
- prefer localhost HTTP/JSON for MVP request/response commands, backed by FastAPI/Pydantic contracts
- add WebSocket later for event streams if needed
- hub API owns capability discovery, health, workspace status, service provisioning, and cross-capability status
- launcher capability API owns model/runtime launch, stop, status, and readiness
- Studio capability API owns instance, project switching, workspace, viewer, capture, focus, and quit

MCP should wrap this same surface. It should not have stronger powers or a separate privileged model.

### Readiness Model

Separate model/runtime readiness from workspace/viewer readiness.

Model/runtime readiness answers:

- is the requested robot/model stack up?
- are required models running?
- are required models healthy?
- is telemetry read/write available?
- are there critical runtime failures?

Workspace/viewer readiness answers:

- is the requested workspace active?
- is the selected viewer option known?
- are frames or telemetry arriving where relevant?
- is the view degraded by upstream failures?

Remote Control readiness is one workspace/viewer projection over the same model/runtime truth, not a separate definition of robot readiness.

### Capture And Shutdown

Capture should be a first-class operation, not a screenshot improvised through UI automation.

Minimum capture metadata:

- timestamp
- project
- workspace
- selected viewer option
- model/runtime readiness summary
- workspace/viewer readiness summary

Shutdown should be staged:

1. renderer enters `quitting`
2. reconnecting clients stop reconnecting
3. websocket/log tasks drain or are cancelled
4. app reports `quit_complete`

Launcher shutdown is a separate Robotick lifecycle operation, not part of Studio quit.

The hub and CLI should expose shutdown blockers rather than leaving the user at `CTRL+C to force quit`.

### MCP Role

MCP is valuable after the hub and operational contract exist.

It gives agents:

- typed tool discovery
- structured arguments
- structured results
- less shell quoting/parsing fragility
- cleaner multi-step workflows

Initial tools should map directly to the hub contract:

- `studio_open`
- `studio_status`
- `studio_list_projects`
- `studio_project_switch`
- `launcher_launch`
- `launcher_wait_ready`
- `studio_workspace_state`
- `studio_viewer_options`
- `studio_viewer_select`
- `studio_capture_panel`
- `studio_get_diagnostics`
- `launcher_stop`
- `studio_quit`

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
      Deliverable: `robotick studio projects`, `robotick studio create`, `robotick studio open`, and the current compatibility shortcut `robotick studio open <project>` now read `robotick.yaml`; empty Studio opens through the shared Studio runner, while project opens dispatch to the registered launch script until project binding moves under instance folders.

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

- [x] Keep `open` action-like rather than auto-binding
      Deliverable: after a successful quiet launch from immediate mode, the shell now stays at `robotick:studio>`, reports an instance folder such as `studio-12345/`, and leaves navigation to `cd studio-12345`.

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
      Deliverable: `tools/robotick-hub/` now exists as a Python/FastAPI/Pydantic service with health, capability listing, workspace identity, service-registry-backed hub record management, workspace project listing, Studio-facing project-list metadata, and a first end-to-end CLI command path through `robotick hub status` and `robotick hub projects`.
      Test scope: FastAPI contract tests for health/capabilities/workspace identity/project-list endpoints, service-registry record tests, real CLI-to-hub startup/status/projects tests, and workspace-shim smoke checks now pass.
      Summary of work done: added the new `tools/robotick-hub/` package, taught `robotick-cli` to bootstrap and query the hub, exposed a minimal `hub/` namespace in one-shot and immediate modes, and kept the slice proportional by limiting it to health/capabilities/projects rather than prematurely routing launcher or Studio control through the hub.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Add desktop tray presence to `robotick-hub`
      Deliverable: when `robotick-hub` runs in a desktop session it also exposes a Robotick tray icon within the same tool/process, surfaces lightweight hub state, and provides safe actions such as opening Studio, viewing status, and stopping the hub; headless environments continue without tray presence.
      Test scope: desktop-session detection tests, tray bootstrap/fallback tests, and hub lifecycle tests proving tray failure handling does not break headless service operation.
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5` / `medium` if desktop integration details become the main challenge

- [ ] Route launcher capability through hub
      Deliverable: `robotick-launcher` exposes small stable functions or service contracts for ensure, status, stop, endpoint discovery, and run-oriented state; `robotick-hub` uses those contracts without importing arbitrary deep launcher internals; launcher is modelled as a workspace capability with runs beneath it rather than as a hidden single-project singleton; and `robotick launcher status` plus the launcher ensure path operate through the hub.
      Test scope: fake launcher provider tests, idempotent ensure tests, run/status mapping tests, and checks that hub code depends only on the stable launcher capability API.
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5` / `medium` if the integration seam gets tangled

- [ ] Open Studio through hub and remove Studio-owned launcher lifecycle
      Deliverable: `robotick studio open` ensures `robotick-hub`, asks hub to ensure required capabilities, opens/registers Studio with the hub endpoint, opens blank with the real workspace project list when no project is specified, opens with the same list plus a preselected target when a project is specified, and Studio no longer starts, stops, supervises, or force-kills launcher processes.
      Test scope: CLI-to-hub open tests, hub Studio registration tests, Studio launch environment/config tests proving the hub endpoint is passed, tests proving blank and preselected Studio opens both expose the same workspace project list, and Studio-side tests proving launcher spawn/stop paths are gone.
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5 XL` only if architectural reasoning starts dominating implementation

- [ ] Finish Studio quit and instance polish on the hub path
      Deliverable: `quit` prefers the Studio control API when available, falls back clearly when needed, updates hub/instance registry state, `ls` and `instances` show lightweight metadata such as current project/mode/launch age, and normal Studio quit no longer stalls on launcher ownership because launcher is outside Studio's process lifecycle.
      Test scope: graceful quit tests, stale-instance cleanup tests, metadata rendering tests, and shutdown tests proving Studio quit does not stop launcher capability state.
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5 XL` for stubborn shutdown/lifecycle reasoning

#### How It Is Looking For Agentic UX

The shape is now materially better for agentic use. The CLI exposes an explicit resource lifecycle: create a Studio instance, discover the reusable instance folder, bind to it, and close it. That is easier for an agent to reason about than the earlier auto-bound shell because creation, navigation, and action are now separate concepts with separate tests. Splitting `create` from composite `open` should improve that further by making the primitive contract scriptable while still giving humans a concise default workflow. The remaining weakness is not the shell grammar; it is the lack of a richer Studio control API behind `quit`, project binding, and readiness, which is why the next work should stay focused on lifecycle/control contracts rather than more prompt polish.

### MVP

Goal: make launch -> ready -> snapshot -> stop -> quit obvious, deterministic, and reliable for humans and external automation.

- [ ] Define MVP Robotick capability/state contract
      Deliverable: documented Studio app, project, launcher, launcher-run, readiness, capture, and shutdown state, including the distinction between Studio target-project selection and launcher run identity.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Implement instance discovery and targeting
      Deliverable: `robotick studio instances`, stable instance folder names, optional targeting flags where still useful, and `ls` support for presenting discovered Studio instances as enterable contexts with reconciled state such as `running`, `degraded`, `stale`, or `gone`.
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
      Deliverable: `robotick launcher launch`, `stop`, `status --json`, and `wait-ready` operate through the launcher capability and work consistently in one-shot and immediate-mode forms.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Implement readiness state
      Deliverable: machine-readable state distinguishing launch requested, launching, running, healthy, degraded, and failed.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Implement workspace/viewer readiness for capture workflows
      Deliverable: active workspace, selected viewer option, receive/present metrics where relevant, and degraded/not-trustworthy state.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Implement first-class capture
      Deliverable: `robotick studio <instance> capture panel ...` writes predictable output plus metadata.
      Recommended Codex model/effort: `gpt-5.4` / `medium`

- [ ] Fix shutdown sequencing
      Deliverable: `robotick studio <instance> quit --wait`, staged shutdown state, blocker diagnostics, and terminal/log reconnect suppression during quit.
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5 XL` if the sequencing/debugging problem proves genuinely hard

- [ ] Make the flow self-describing
      Deliverable: a cold operator or bot can discover the canonical flow from `README.md`, `AGENTS.md`, `robotick.yaml`, and `robotick studio --help`; context listings surface instance state clearly; and visual treatment differentiates enterable contexts from action commands in the same way `ls` already distinguishes folders from non-folder entries.
      Recommended Codex model/effort: `gpt-5.4-mini` / `low`

### Success Criteria

The Barr.e baseline should become:

```bash
robotick studio open
robotick studio studio-12345 project barr-e
robotick launcher launch --project barr-e --profile local:ALL
robotick launcher wait-ready --project barr-e --workspace remote-control
robotick studio studio-12345 capture panel --workspace remote-control --panel main --out artifacts/...
robotick launcher stop --project barr-e
robotick studio studio-12345 quit --wait
```

The equivalent interactive flow should work after binding an instance:

```text
robotick studio
open
ls
cd studio-12345
robotick:studio:studio-12345>
project barr-e
launcher launch --project barr-e --profile local:ALL
launcher wait-ready --project barr-e --workspace remote-control
capture panel --workspace remote-control --panel main --out artifacts/...
launcher stop --project barr-e
quit
```

The equivalent MCP workflow should complete without repo rummaging, script-path discovery, UI selector discovery, visual-state guessing, or log scraping for basic operational truth.

### Future Work

- [ ] Artifact/output conventions once capture workflows settle
      Recommended Codex model/effort: `gpt-5.4-mini` / `low`
- [ ] Richer log inspection and tailing commands
      Deliverable: explicit log viewing/tailing commands beyond the current `--attach` launch mode
      Recommended Codex model/effort: `gpt-5.4-mini` / `medium`
- [ ] Richer `workspace`, `viewer`, `diagnostics`, `capture`, and child-window coverage
      Recommended Codex model/effort: `gpt-5.4` / `medium`
- [ ] MCP adapter over the same operational contract
      Recommended Codex model/effort: `gpt-5.4` / `medium`, escalate to `gpt-5.5 XL` if the cross-contract design work becomes the main challenge
- [ ] Broader telemetry/model inspection commands
      Recommended Codex model/effort: `gpt-5.4` / `medium`
- [ ] Stronger visibility/focus/window-state introspection
      Recommended Codex model/effort: `gpt-5.4` / `medium`
- [ ] Python or other scripting client over the same contract
      Recommended Codex model/effort: `gpt-5.4-mini` / `medium`
