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

| Artifact | Path |
| --- | --- |
| First run full-window screenshot | `/tmp/robotick-baseline/output/barr-e-studio-full.png` |
| First run RC screenshot | `/tmp/robotick-baseline/output/barr-e-rc.png` |
| First run timing log | `/tmp/robotick-baseline/output/baseline-log.json` |
| Rerun full-window screenshot | `/tmp/robotick-baseline/rerun/studio-full.png` |

Execution timings:

| Step | Duration |
| --- | ---: |
| Launch Studio to attachable renderer | `6-12s` |
| Attach via Electron CDP | `0.54s` |
| Click `Start launcher` | `0.05s` |
| UI acknowledgment via `Stop launcher` | `0.01s` |
| First run: RC placeholder gone | `33.16s` |
| First run: save full screenshot | `0.48s` |
| First run: save RC screenshot | `0.51s` |
| Stop launcher | `6.88s` |
| Click Studio close | `0.03s` |
| Rerun: RC placeholder gone | `20.08s` |

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

Build a small, explicit operating layer for Robotick Studio, then expose it through a human/script CLI and later MCP.

The layers should be:

1. Studio operational contract
2. `robotick studio ...` CLI
3. workspace project registration and docs
4. MCP adapter over the same contract

Python scripting is out of scope for this phase. It can be added later as another client of the same operational contract.

### CLI Shape

Use `robotick` as the umbrella command and `studio` as the Studio namespace.

Examples:

```bash
robotick studio projects
robotick studio open barr-e
robotick studio instances
robotick studio project switch barr-e --instance <id>
robotick studio launcher launch --instance <id> --profile local:ALL
robotick studio launcher wait-ready --instance <id> --workspace remote-control
robotick studio capture panel --instance <id> --workspace remote-control --panel main --out artifacts/...
robotick studio launcher stop --instance <id>
robotick studio quit --instance <id> --wait
```

Interactive mode should also be supported:

```text
robotick> studio
robotick:studio> projects
robotick:studio> ls
robotick:studio> open barr-e
robotick:studio> clear
robotick:studio> back
robotick> exit
```

Command style:

- use namespaced commands for domains: `project`, `launcher`, `workspace`, `viewer`, `capture`
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

Recommended CLI implementation:

- Phase 0 workspace bootstrap shim: `./tools/robotick`
- intended long-term command name: `robotick`
- source location: `robotick/robotick-studio/tools/robotick-cli/`
- language: TypeScript/Node
- normal use should not expose `npm`, `node`, or package-manager details
- a literal root `./robotick` file is not possible in this repo because `robotick/` is already a top-level directory
- an installed `robotick` shim should be able to find the nearest workspace and delegate to its local tool
- the stable user-facing command should be `robotick`; the workspace shim exists only as bootstrap and local fallback

Recommended Studio instance model:

- each running Studio instance advertises a stable instance id
- each instance registration includes process id, active project, control endpoint, and app lifecycle state
- MVP registry can be a workspace-local runtime directory, for example `.robotick/instances/`
- each instance should write and remove its own registration record

Recommended transport:

- use explicit local IPC for Studio control
- prefer localhost HTTP/JSON for MVP request/response commands
- add WebSocket later for event streams if needed
- launcher API owns model/runtime launch, stop, status, and readiness
- Studio control API owns instance, project switching, workspace, viewer, capture, focus, and quit

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
3. launcher stop begins
4. websocket/log tasks drain or are cancelled
5. app reports `quit_complete`

The CLI should expose shutdown blockers rather than leaving the user at `CTRL+C to force quit`.

### MCP Role

MCP is valuable after the CLI and operational contract exist.

It gives agents:

- typed tool discovery
- structured arguments
- structured results
- less shell quoting/parsing fragility
- cleaner multi-step workflows

Initial tools should map directly to the CLI/contract:

- `studio_open`
- `studio_status`
- `studio_list_projects`
- `studio_project_switch`
- `studio_launcher_launch`
- `studio_launcher_wait_ready`
- `studio_workspace_state`
- `studio_viewer_options`
- `studio_viewer_select`
- `studio_capture_panel`
- `studio_get_diagnostics`
- `studio_launcher_stop`
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
  Deliverable: `robotick studio projects` and `robotick studio open <project>` now read `robotick.yaml`; `open` currently dispatches to the registered launch script.

### MVP

Goal: make launch -> ready -> snapshot -> stop -> quit obvious, deterministic, and reliable for humans and external automation.

- [ ] Define MVP Studio command/state contract
  Deliverable: documented app, project, launcher, readiness, capture, and shutdown state.

- [ ] Implement instance discovery and targeting
  Deliverable: `robotick studio instances`, stable ids, and `--instance` support.

- [ ] Implement bound interactive mode
  Deliverable: `robotick studio` opens a REPL that can bind to an instance and run repeated commands without `--instance`.

- [ ] Implement project switching
  Deliverable: `robotick studio project switch <project> --instance <id>` with explicit success/failure state.

- [ ] Implement launcher commands
  Deliverable: `launcher launch`, `launcher stop`, `launcher status --json`, and `launcher wait-ready`.

- [ ] Implement readiness state
  Deliverable: machine-readable state distinguishing launch requested, launching, running, healthy, degraded, and failed.

- [ ] Implement workspace/viewer readiness for capture workflows
  Deliverable: active workspace, selected viewer option, receive/present metrics where relevant, and degraded/not-trustworthy state.

- [ ] Implement first-class capture
  Deliverable: `robotick studio capture panel ...` writes predictable output plus metadata.

- [ ] Fix shutdown sequencing
  Deliverable: `robotick studio quit --instance <id> --wait`, staged shutdown state, blocker diagnostics, and terminal/log reconnect suppression during quit.

- [ ] Make the flow self-describing
  Deliverable: a cold operator or bot can discover the canonical flow from `README.md`, `AGENTS.md`, `robotick.yaml`, and `robotick studio --help`.

### Success Criteria

The Barr.e baseline should become:

```bash
robotick studio open barr-e
robotick studio launcher launch --instance <id> --profile local:ALL
robotick studio launcher wait-ready --instance <id> --workspace remote-control
robotick studio capture panel --instance <id> --workspace remote-control --panel main --out artifacts/...
robotick studio launcher stop --instance <id>
robotick studio quit --instance <id> --wait
```

The equivalent interactive flow should work after binding an instance:

```text
robotick studio
bind <id>
project switch barr-e
launcher launch --profile local:ALL
launcher wait-ready --workspace remote-control
capture panel --workspace remote-control --panel main --out artifacts/...
launcher stop
quit
```

The equivalent MCP workflow should complete without repo rummaging, script-path discovery, UI selector discovery, visual-state guessing, or log scraping for basic operational truth.

### Future Work

- [ ] Artifact/output conventions once capture workflows settle
- [ ] Richer `workspace`, `viewer`, `diagnostics`, `capture`, and child-window coverage
- [ ] MCP adapter over the same operational contract
- [ ] Broader telemetry/model inspection commands
- [ ] Stronger visibility/focus/window-state introspection
- [ ] Python or other scripting client over the same contract
