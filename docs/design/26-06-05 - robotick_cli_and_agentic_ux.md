# Studio Bot-UX Baseline And Improvement Plan

Date: 2026-06-05
Project used for baseline: `robots/barr-e`

## Background

This note records a control/baseline run of Robotick Studio from the perspective of an external coding/automation agent using the current product surface, without a dedicated Studio automation contract.

The baseline task was:

1. launch Studio
2. launch Barr.e
3. capture a screenshot from the main Remote Control viewport
4. stop Barr.e cleanly
5. exit Studio cleanly

The purpose was to measure not only execution time, but also discovery cost:

- how much repo/UI rummaging was required
- how obvious the available actions were
- where hidden state or ambiguity blocked reliable automation

Scope for this plan:

- in scope:
  - Studio operational contract
  - `robotick studio ...` CLI
  - interactive bound CLI mode
  - readiness/failure/shutdown semantics
  - workspace-root project registration and discovery guidance
  - MCP adapter over the same contract
- out of scope for this phase:
  - Python scripting client

## Current State

### Artifacts

- First run full-window screenshot: `/tmp/robotick-baseline/output/barr-e-studio-full.png`
- First run RC screenshot: `/tmp/robotick-baseline/output/barr-e-rc.png`
- First run timing log: `/tmp/robotick-baseline/output/baseline-log.json`
- Rerun full-window screenshot: `/tmp/robotick-baseline/rerun/studio-full.png`

Interpretation:

- The first run completed mechanically but did not clearly satisfy the visual goal. The RC viewport was black.
- The rerun produced a materially better full-window screenshot and better matched the user-facing objective.

### Current Human Workflows

From the current UI and config surfaces, Studio is organized around these human workflows:

- open Studio on a project
- select a project
- select a launcher profile
- launch/stop a robot or profile
- inspect `Remote Control`
- inspect `Telemetry`
- inspect `Models`
- inspect `Project`
- inspect `Terminal`
- manage child windows
- capture or observe the current visual state
- quit Studio

These workflows already appear in the current workspaces and header controls:

- `Home`
- `Project`
- `Models`
- `Remote Control`
- `Telemetry`
- `Terminal`
- `Help`
- project picker
- profile picker
- launcher controls
- child-window controls
- window controls

The functional shape is good. The main problem is that the operational contract behind these workflows is implicit rather than explicit.

### Baseline Workflow

The baseline was executed through the normal Barr.e Studio path:

- launch path: `./robots/barr-e/run-studio.sh`
- Studio mode: Electron dev mode through the existing repo scripts
- control surface used during the run: Electron Chromium debug port at `127.0.0.1:9222`

The renderer route opened on `#/remote-control`, which matched the requested workflow well.

### Timings

These are step durations in seconds, not cumulative session timestamps.

| Step | Duration (s) | Notes |
| --- | ---: | --- |
| Launch Studio via `./robots/barr-e/run-studio.sh` to renderer attach/debuggable window | `6-12` | Approximate observed range; includes Electron startup and launcher/backend bootstrap noise |
| Attach to renderer and wait for `networkidle` | `0.54` | CDP attach path |
| Confirm `Start launcher` visible | `0.04` | |
| Click `Start launcher` | `0.05` | |
| Wait for UI acknowledgment via `Stop launcher` | `0.01` | Fast acknowledgment, not proof of readiness |
| Wait for RC placeholder to disappear after launch | `33.16` | First run |
| Wait for detectable viewport content after placeholder removal | `0.04` | False-positive readiness signal in first run |
| Measure/bind RC viewport bounds | `0.04` | |
| Save first-run full screenshot | `0.48` | |
| Save first-run RC screenshot | `0.51` | |
| Click `Stop launcher` | `0.08` | |
| Wait for launcher to return to stopped state | `6.88` | First run |
| Click Studio close | `0.03` | |

Rerun timing highlight:

| Step | Duration (s) | Notes |
| --- | ---: | --- |
| Start launcher click to RC placeholder gone | `20.08` | Faster than first run |
| Deliberate visible pause before stop | `5.00` | Left open to confirm visible-state behavior |

### Discovery And Rummaging Cost

The main friction was not clicking buttons. It was discovering the operational contract.

These figures are human-equivalent effort estimates for a cold operator/engineer trying to work out the path from local context. They are not literal wall-clock timings of my internal execution.

Approximate discovery cost before a stable run:

| Workflow slice | Approx. effort | Notes |
| --- | ---: | --- |
| Find canonical Studio launch path | `1-2 min` | Barr.e wrapper plus shared Studio runner |
| Work out whether desktop automation was possible | `2-3 min` | Checked session/display/tool availability |
| Discover least invasive control path | `2-4 min` | Chose CDP because Electron dev mode already exposes it |
| Make Playwright usable in this environment | `2-4 min` | `npx playwright --version` worked, but `require('playwright')` failed; used a throwaway install |
| Discover active route/workspace and visible controls | `2-3 min` | Needed config and UI inspection |
| Refine selectors and launch heuristics | `1-2 min` | First selector collided with `Restart launcher`; first readiness heuristic was wrong |
| Total discovery/rummaging overhead | `10-18 min` | High enough that the workflow is not self-describing |

Rummaging indicators:

| Signal | Count | Notes |
| --- | ---: | --- |
| Exploratory shell searches / file reads | `15+` | launch scripts, workspaces, editors, header controls, RC config, environment |
| Environment/tool capability checks | `5+` | display/session, screenshot tools, automation tools, Playwright |
| Failed or partial automation attempts | `4` | module-load and selector failures |
| Heuristic corrections | `1+` | “placeholder gone + canvas exists” was not enough |

### Findings

#### 1. The flow was mechanically possible but operationally ambiguous

Studio launched, Barr.e launch was triggered, screenshots were captured, Barr.e was stopped, and Studio exited.

But several different states currently look like “success” even though they are not equivalent:

- run request accepted
- launcher status running
- RC placeholder gone
- viewport canvas exists
- stream is alive
- Barr.e is visibly present
- required models are healthy

These states need to be separated and named.

#### 2. The first readiness heuristic was wrong

On the first run:

- the RC placeholder disappeared
- viewport content technically existed
- but the viewport was black
- RC overlay showed `Receive: 0.0 Hz`
- RC overlay showed `Present: 0.0 Hz`

So “placeholder gone” and “canvas exists” are not valid proxies for “Remote Control is ready.”

#### 3. Visual outcome was nondeterministic across runs

- First run: poor RC result, black viewport
- Rerun: materially better full-window screenshot

That means repeated runs can produce meaningfully different visual outcomes even when the nominal workflow is the same.

#### 4. The UI can advance while runtime health is bad

Launcher output showed model failures while the UI still progressed past the RC placeholder state.

Observed failures included:

- `barr-e-face` with exit status `137` on the first run
- on rerun, failures were also reported for:
  - `barr-e-expression`
  - `barr-e-face`
  - `barr-e-mind`
  - `barr-e-sensing-auditory`
  - `barr-e-spine`

This is a major UX issue:

- humans can be shown a seemingly-ready workspace that is actually degraded
- automation cannot trust visual/UI transitions as launch success signals

#### 5. Shutdown succeeds, but shutdown quality is weak

Studio generally exited successfully, but not perfectly cleanly.

Observed issues:

- Python resource-tracker warning about leaked semaphores
- terminal websocket disconnect/reconnect noise during shutdown
- a known hang shape where shutdown prints:
  - `Waiting for background tasks to complete. (CTRL+C to force quit)`

Likely mechanism:

- `/launcher/stop` succeeds
- launcher websocket/log stream closes
- renderer terminal log client attempts reconnect
- Uvicorn waits on background tasks

Shutdown needs explicit staging, not just “close the window and hope.”

#### 6. Visibility state is not explicit enough

The Electron window definitely existed and was interactable through CDP.

But proving whether it was visible on the exact desktop/workspace the user was watching was harder than it should be. A root-desktop capture attempt failed under this session.

This means Studio lacks an explicit externally-queryable visibility/focus contract.

## Recommendations

The right improvement is a layered operational contract:

1. internal Studio command/state contract
2. human/script CLI
3. workspace-root project registration + human/agent guidance
4. MCP wrapper for agent use

### 1. Add an internal Studio operational contract

Studio needs a small explicit command/state layer behind the UI.

Required command concepts:

- app lifecycle:
  - `open`
  - `quit`
  - `get_app_state`
- project/profile:
  - `list_projects`
  - `get_active_project`
  - `set_active_project`
  - `list_profiles`
  - `get_active_profile`
  - `set_active_profile`
- launch/runtime:
  - `launch`
  - `stop`
  - `get_launch_state`
  - `wait_ready`
- workspaces/panels:
  - `list_workspaces`
  - `get_active_workspace`
  - `open_workspace`
  - `list_panels`
  - `focus_panel`
- RC/telemetry:
  - `get_workspace_state`
  - `get_viewer_options`
  - `select_viewer_option`
  - `get_telemetry_state`
- capture/diagnostics:
  - `capture_window`
  - `capture_workspace`
  - `capture_panel`
  - `get_diagnostics`

Required state concepts:

- app lifecycle:
  - `starting`
  - `window_created`
  - `window_visible`
  - `renderer_ready`
  - `quitting`
  - `quit_complete`
- launch/runtime:
  - `launch_requested`
  - `launching`
  - `running`
  - `degraded`
  - `failed`
  - `stopping`
  - `stopped`
- readiness:
  - `required_models_running`
  - `required_models_healthy`
  - `selected_stream_receive_hz`
  - `selected_stream_present_hz`
  - `workspace_ready`

### 2. Build `robotick studio ...` as the first external surface

This is the first major UX win. It benefits humans, scripts, CI, and external automation immediately.

The command should support both:

- one-shot command mode for scripting
- bound interactive mode for humans and longer workflows

Recommended behavior:

- `robotick studio`
  - enters an interactive CLI session
  - can list instances, bind to one, open a new one, switch projects, launch, inspect, capture, stop, and quit
- `robotick studio <subcommand>`
  - runs a one-shot command for scripts and automation

Recommended commands:

| Command | Purpose |
| --- | --- |
| `robotick studio open barr-e` | open a new Studio instance on Barr.e |
| `robotick studio instances` | list running instances |
| `robotick studio project list` | list registered compatible projects |
| `robotick studio status --instance <id> --json` | machine-readable operational status |
| `robotick studio project switch barr-e --instance <id>` | switch a specific existing instance to Barr.e |
| `robotick studio workspace open --instance <id> remote-control` | explicit workspace navigation |
| `robotick studio launcher launch --instance <id> --profile local:ALL` | start a launch profile |
| `robotick studio launcher wait-ready --instance <id> --workspace remote-control` | wait for explicit readiness |
| `robotick studio workspace state remote-control --instance <id>` | inspect workspace state |
| `robotick studio viewer options --workspace remote-control --instance <id>` | list viewer options and health |
| `robotick studio viewer select Chase --workspace remote-control --instance <id>` | choose viewer option explicitly |
| `robotick studio capture panel --instance <id> --workspace remote-control --panel main --out ...` | stable capture |
| `robotick studio launcher stop --instance <id>` | stop launcher/profile |
| `robotick studio focus --instance <id>` | focus a running instance |
| `robotick studio quit --instance <id> --wait` | quit cleanly |

Interactive mode should support a bound instance model so repeated commands do not need `--instance` every time.

Illustrative session:

```text
robotick studio> instances
robotick studio> bind studio-123
robotick studio[studio-123]> status
robotick studio[studio-123]> project switch barr-e
robotick studio[studio-123]> launcher launch --profile local:ALL
robotick studio[studio-123]> launcher wait-ready --workspace remote-control
robotick studio[studio-123]> viewer options --workspace remote-control
robotick studio[studio-123]> viewer select Chase --workspace remote-control
robotick studio[studio-123]> capture panel --workspace remote-control --panel main --out artifacts/...
robotick studio[studio-123]> launcher stop
robotick studio[studio-123]> quit
```

Command-style rule:

- use namespaced commands to group concerns:
  - `project`
  - `launcher`
  - `workspace`
  - `viewer`
  - `capture`
- use plain positional arguments for the direct object:
  - project name
  - workspace name
  - viewer option
  - panel id
- use `--flags` for context and modifiers:
  - `--instance`
  - `--profile`
  - `--workspace`
  - `--panel`
  - `--out`
  - `--wait`
  - `--timeout`
  - `--json`

CLI output requirements:

- human-readable by default
- `--json` for all diagnostic/status surfaces
- explicit exit codes for:
  - invalid args
  - launch failure
  - readiness timeout
  - degraded state
  - shutdown timeout

### 3. Define an explicit robot/model readiness contract

Studio should separate:

- model/runtime readiness
- workspace/viewer readiness

Model readiness answers:

- is the requested robot/model stack actually up?
- are the required models running?
- are they healthy enough to trust?

Recommended model readiness checks:

| Check | Why it matters |
| --- | --- |
| launcher state is `running` | request accepted is not enough |
| required models are `running` | prevents false-positive launch success |
| required models are `healthy` | catches rc=137-style failures |
| no critical runtime failures | prevents “ready but broken” states |
| required telemetry publishers are alive | proves the runtime can actually feed downstream workspaces |

This should be the generic readiness gate for launch, automation, and diagnosis.

### 4. Define workspace/viewer readiness separately

Once model/runtime readiness is satisfied, Studio should support a second layer of readiness for whichever workspace the user or tool actually wants to use.

This covers things like:

- `Remote Control`
- `Telemetry`
- `Models`
- future specialist workspaces

For the Barr.e baseline, RC/viewer readiness then becomes a concrete workspace-specific check:

| Check | Why it matters |
| --- | --- |
| active workspace is `remote-control` | ensures the right surface is in use |
| selected viewer option/stream is known | avoids silent wrong-view captures |
| selected stream `Receive > 0` | proves frames are arriving |
| selected stream `Present > 0` | proves frames are rendering |
| selected view is not degraded by known upstream failures | prevents “workspace open but not trustworthy” states |

In principle, RC readiness should not be a different kind of truth from telemetry readiness. It should be another workspace/viewer projection over the same underlying model/runtime state.

### 5. Surface failures as structured state, not just logs

Studio should expose:

- failed model id
- exit code
- failure phase
- severity
- whether the current workspace is degraded
- whether the selected stream is dead

This is required for both human trust and agent trust.

### 6. Add a stable screenshot/export surface

Capture should be a first-class operation, not something improvised through UI automation.

Recommended capture operations:

- `capture_window`
- `capture_workspace remote-control`
- `capture_panel main-rc-view`

Capture metadata should include:

- timestamp
- active workspace
- selected stream
- receive/present rates
- model health summary

### 7. Expose visibility/focus/window state

Studio should provide:

- window exists
- window focused
- window visible on current workspace
- window bounds
- minimized/maximized state

Without this, both humans and bots are left guessing whether “the app is up” is actually true in the desktop session they care about.

### 8. Fix shutdown sequencing

Recommended shutdown stages:

1. renderer enters `quitting`
2. reconnecting clients stop reconnecting
3. launcher stop begins
4. websocket/log tasks drain or are cancelled
5. app reports `quit_complete`

Expose shutdown diagnostics:

- active background tasks
- reconnecting websocket clients
- shutdown timeout reason
- forced-quit required: yes/no

### 9. Add a minimal workspace-root project contract and clear docs

For MVP, the workspace should expose two simple things:

- a machine-readable project registration file
- clear human and agent docs

Recommended machine-readable file:

- `robotick.yaml`

Recommended initial scope for `robotick.yaml`:

- Studio path/mode defaults for this workspace
- registered projects
- canonical per-project launch script or equivalent entrypoint

This should stay intentionally static and simple. It should not try to redefine product truths such as launcher/model readiness.

Recommended documentation split:

- `README.md`
  - human-first, canonical launch and usage guidance
  - normal `robotick studio ...` flow should be obvious here
- `AGENTS.md`
  - short operational supplement for bots and advanced automation
  - should help an external tool find the canonical control surface quickly

Humans should not need `AGENTS.md` to discover the normal Studio flow. `AGENTS.md` should reduce bot rummaging, not compensate for a weak `README.md`.

### 10. Add MCP on top of the same contract

MCP is still worth adding, but it should wrap the same Studio operational surface rather than invent a second model.

Recommended initial MCP tools:

- `studio_open`
- `studio_status`
- `studio_list_projects`
- `studio_list_profiles`
- `studio_project_switch`
- `studio_open_workspace`
- `studio_launcher_launch`
- `studio_launcher_wait_ready`
- `studio_workspace_state`
- `studio_viewer_options`
- `studio_viewer_select`
- `studio_capture_panel`
- `studio_get_diagnostics`
- `studio_launcher_stop`
- `studio_quit`

Why MCP is worth adding after the CLI:

- CLI makes Studio operable
- MCP makes Studio agent-native
- MCP removes shell quoting/parsing fragility
- MCP gives typed arguments and structured results
- MCP enables longer adaptive workflows without UI scraping

Constraint:

- MCP should not expose stronger operational powers than the underlying Studio contract and CLI expose.
- It should be an agent-facing adapter, not a separate privileged control plane.

### Implementation Plan

| Phase | Deliverable | Outcome |
| --- | --- | --- |
| 1 | internal command/state contract | one operational truth inside Studio |
| 2 | explicit readiness + structured failure state | removes false-positive launch success |
| 3 | `robotick studio ...` one-shot commands + interactive bound mode | immediate UX gain for humans and scripts |
| 4 | capture surface + predictable output behavior | reproducible diagnostics |
| 5 | shutdown sequencing fix | removes forced-quit pain |
| 6 | workspace-root `robotick.yaml`, `README.md`, and `AGENTS.md` | reduces future rummaging |
| 7 | MCP adapter on top of same contract | full agent-native operation |

### Success Criteria

This plan is successful when the Barr.e baseline can be expressed as:

One-shot form:

1. `robotick studio open barr-e`
2. `robotick studio launcher launch --instance <id> --profile local:ALL`
3. `robotick studio launcher wait-ready --instance <id> --workspace remote-control`
4. `robotick studio capture panel --instance <id> --workspace remote-control --panel main --out artifacts/...`
5. `robotick studio launcher stop --instance <id>`
6. `robotick studio quit --instance <id> --wait`

Interactive bound form:

1. `robotick studio`
2. `bind <id>`
3. `project switch barr-e`
4. `launcher launch --profile local:ALL`
5. `launcher wait-ready --workspace remote-control`
6. `capture panel --workspace remote-control --panel main --out artifacts/...`
7. `launcher stop`
8. `quit`

And when the equivalent MCP workflow can do the same without:

- repo rummaging
- script-path discovery
- UI selector discovery
- visual-state guessing
- log scraping for basic operational truth

## Task List

### MVP Scope

Goal:

- make the launch -> ready -> snapshot -> stop -> quit flow obvious, deterministic, and reliable for both humans and external automation
- validate the basic `robotick` CLI shape early with a deliberately small hello-world slice

MVP success target:

- a clean Barr.e-style workflow can be run with one canonical command surface
- launch success is explicit
- model readiness is explicit
- workspace/viewer readiness is explicit where needed for capture
- screenshot capture is first-class
- shutdown completes cleanly enough that forced quit is no longer the expected outcome

- [ ] Define the minimal workspace-root project contract
  Deliverable:
  - a root `robotick.yaml` declaring:
    - default Studio path/mode
    - registered projects
    - canonical per-project launch script or equivalent entrypoint
  - no manifest-defined readiness policy
  - no early artifact/output policy in this file

- [ ] Make the normal launch path obvious to humans and agents
  Deliverable:
  - `README.md` clearly documents the canonical human `robotick studio ...` flow
  - `AGENTS.md` provides a short bot/operator supplement without replacing the human docs

- [ ] Build a hello-world `robotick` CLI slice before deeper automation
  Deliverable:
  - `robotick studio projects`
  - `robotick studio open <project>`
  - both commands read `robotick.yaml`
  - `open` can initially dispatch to the registered launch script
  - this slice is used to validate naming, folder structure, argument style, and workspace-root UX

- [ ] Define the MVP internal command/state contract
  Deliverable:
  - a documented minimal operational contract covering:
    - app open/quit state
    - active project
    - launcher state
    - model/runtime readiness
    - workspace/viewer readiness
    - screenshot capture

- [ ] Implement canonical `robotick studio open` behavior
  Deliverable:
  - `robotick studio open <project>` opens a new Studio instance for a registered project using the workspace-defined Studio path/mode
  - once the hello-world slice exists, this grows from script dispatch into the canonical open path

- [ ] Implement instance discovery and explicit instance targeting
  Deliverable:
  - `robotick studio instances`
  - stable instance ids
  - commands can target a specific instance with `--instance`

- [ ] Implement bound interactive CLI mode as part of MVP
  Deliverable:
  - `robotick studio` with no subcommand enters a bound operator shell
  - shell can:
    - list instances
    - bind to one
    - switch project
    - launch
    - wait for readiness
    - capture
    - stop
    - quit
  - repeated commands do not require `--instance`
  - CLI spam is reduced for normal multi-step workflows

- [ ] Implement project switching on a chosen instance
  Deliverable:
  - `robotick studio project switch <project> --instance <id>`
  - explicit success/failure state when switching

- [ ] Implement launcher control commands for MVP
  Deliverable:
  - `robotick studio launcher launch --instance <id> --profile ...`
  - `robotick studio launcher stop --instance <id>`
  - `robotick studio launcher status --instance <id> --json`

- [ ] Implement explicit model/runtime readiness checks
  Deliverable:
  - a machine-readable readiness result that distinguishes:
    - launch requested
    - launching
    - model stack running
    - model stack healthy
    - degraded
    - failed

- [ ] Implement explicit workspace/viewer readiness checks for capture workflows
  Deliverable:
  - for `remote-control` and other capture-relevant workspaces, a machine-readable readiness result that includes:
    - active workspace
    - selected viewer option
    - receive/present metrics if relevant
    - degraded/not-trustworthy state

- [ ] Implement first-class screenshot capture
  Deliverable:
  - `robotick studio capture panel ...`
  - output file written to a predictable path
  - capture metadata including timestamp, project, workspace, selected viewer option, and health/readiness summary

- [ ] Make shutdown sequencing explicit enough to remove routine forced-quit behavior
  Deliverable:
  - `robotick studio quit --instance <id> --wait`
  - staged shutdown state
  - diagnostics for shutdown blockers
  - terminal/log reconnects suppressed during app quit

- [ ] Make the MVP flow self-describing
  Deliverable:
  - a cold operator or bot can discover the canonical flow from `README.md`, `AGENTS.md`, `robotick.yaml`, and `robotick studio --help` without repo rummaging

### Future Work

These are valuable, but not required for the MVP launch/snapshot/exit goal.

- [ ] Artifact/output conventions
  Deliverable:
  - standard output locations for captures and related automation artifacts once capture workflows have settled

- [ ] Richer namespaced command surface across more workspaces
  Deliverable:
  - broader `workspace`, `viewer`, `diagnostics`, `capture`, and child-window coverage

- [ ] MCP adapter on top of the same operational contract
  Deliverable:
  - Studio becomes agent-native without adding privileged powers beyond the CLI/contract

- [ ] Broader telemetry/model inspection surfaces
  Deliverable:
  - richer `telemetry`, `models`, and diagnostics commands beyond MVP readiness and capture

- [ ] Visibility/focus/window-state introspection polish
  Deliverable:
  - stronger guarantees around whether the user’s current desktop session is actually showing the intended Studio instance

- [ ] Python or other scripting client
  Deliverable:
  - script library over the same operational contract
  - explicitly deferred from MVP
