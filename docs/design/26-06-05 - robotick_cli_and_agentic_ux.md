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

Build a small, explicit operating layer for Robotick Studio, then expose it through a human/script CLI and later MCP.

The layers should be:

1. Studio operational contract
2. `robotick studio ...` CLI
3. workspace project registration and docs
4. MCP adapter over the same contract

Python scripting is out of scope for this phase. It can be added later as another client of the same operational contract.

Testing should be part of implementation throughout, not deferred to the end. Each supported command/state permutation should be locked down as soon as it is introduced, even if that means catch-up tests while the CLI grammar is still being shaped.

### CLI Shape

Use `robotick` as the umbrella command and `studio` as the Studio namespace.

The CLI should follow a path-oriented grammar:

- context-forming commands behave like directories
- action commands behave like executables/files
- the shell prompt is a rendering of the current bound context stack
- `back` pops one level from that stack
- `ls` should present context-forming entries with a directory-like feel, for example `studio/` or `studio-12345/`
- one-shot commands and immediate-mode navigation should describe the same hierarchy, not two different mental models

That metaphor should inform the whole interface:

- `studio` is a context
- `create` is the primitive action that materializes a Studio session without changing context
- `open` is a composite action over the primitives, initially `create` + `cd`
- session folders such as `studio-12345/` are the persistent contexts representing open Studio sessions
- later contexts such as `project[...]`, `workspace[...]`, and `viewer[...]` should only appear once they are genuinely bound inside a specific session folder
- actions such as `launch`, `stop`, `status`, `capture`, and `quit` run within the current bound context rather than pretending to be peers of it

The command hierarchy should therefore be explicit and path-like:

- `robotick`
  top-level entrypoint and shell root
- `robotick studio`
  Studio namespace
- `robotick studio create`
  create/materialize a new Studio session without changing context
- `robotick studio open`
  composite convenience command that creates a new Studio session and enters it
- `robotick studio <session>`
  enter or target an existing Studio session context
- `robotick studio <session> project ...`
  bind or operate on project state within that session
- `robotick studio <session> launcher ...`
  operate on launcher/model lifecycle within that session
- `robotick studio <session> workspace ...`
  bind or operate on workspace state within that session
- `robotick studio <session> viewer ...`
  bind or operate on viewer state within that session
- `robotick studio <session> capture ...`
  capture panels or views from that session
- `robotick studio <session> quit`
  close the targeted Studio session

The interactive shell should mirror that hierarchy rather than inventing different semantics:

- `robotick>`
  top-level shell
- `robotick:studio>`
  Studio namespace shell
- `robotick:studio:studio-12345>`
  shell bound to a specific open Studio session

Within that bound prompt, everything should be understood as operating on the currently open Studio session. In other words, `studio-12345/` is the user-facing hierarchy for “the Studio session I currently have open”, and the shell should behave as though the user has `cd`'d into that session.

`back` should always unwind one shell level. The bound-session prompt is a path/state indicator. Once bound to a Studio session, the commands available there are the operations and deeper context bindings on that session, while `open` remains the action used back at `robotick:studio>` to create another session.

Shell-control commands should stay distinct:

- `back`
  leave the current shell context and return to the parent context
- `exit`
  leave the Robotick CLI itself
- `quit`
  close the currently bound Studio session, then return to the parent Studio shell context

That also means `ls` should be visually biased toward the path metaphor:

- show context-forming entries separately from actions where useful
- render contexts in a directory-like style, such as `studio/` and `studio-12345/`
- surface concrete enterable contexts only where they are genuinely bound, such as discovered Studio instances and, later, project/workspace/viewer context within an already open Studio session
- avoid flattening contexts and actions into one undifferentiated list

Examples:

```bash
robotick studio projects
robotick studio open
robotick studio instances
robotick studio studio-12345 project barr-e
robotick studio studio-12345 launcher launch --profile local:ALL
robotick studio studio-12345 launcher wait-ready --workspace remote-control
robotick studio studio-12345 capture panel --workspace remote-control --panel main --out artifacts/...
robotick studio studio-12345 launcher stop
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
robotick:studio:studio-12345> launcher launch
robotick:studio:studio-12345> clear
robotick:studio:studio-12345> quit
robotick:studio> back
robotick> exit
```

Command style:

- use path-forming nouns/contexts for scope: `studio`, session folders such as `studio-12345`, and later `project`, `workspace`, `viewer`
- use action commands within the current scope for work: `launch`, `stop`, `status`, `capture`, `quit`
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
      Deliverable: `robotick studio projects`, `robotick studio create`, `robotick studio open`, and the current compatibility shortcut `robotick studio open <project>` now read `robotick.yaml`; empty Studio opens through the shared Studio runner, while project opens dispatch to the registered launch script until project binding moves under session folders.

- [x] Added immediate-mode Studio open path
      Deliverable: inside `robotick:studio>`, `create` now launches empty Studio without binding, `open` creates and immediately binds to the new session, and the current compatibility shortcut `open <project>` creates and enters a registered project directly.

### Pre-MVP: Open/Close UX

Goal: make `robotick studio open ...` and the eventual Studio close path feel like Robotick commands rather than raw dev-script passthrough.

- [x] Reduced launch spam
      Deliverable: `robotick studio open <project>` now reports concise Robotick-level progress by default rather than dumping full `npm` / `vite` / Electron output immediately.

- [x] Made log attachment intentional
      Deliverable: normal open flows now stay quiet by default, and `robotick studio open <project> --attach` is available for power-users who want the full Studio log stream.

- [x] Surface Studio-level success
      Deliverable: `open` now reports a Robotick-level result including Studio launch start, log location, and a provisional instance identity instead of only inheriting child-process lifetime.

- [x] Keep `open` action-like rather than auto-binding
      Deliverable: after a successful quiet launch from immediate mode, the shell now stays at `robotick:studio>`, reports a session folder such as `studio-12345/`, and leaves navigation to `cd studio-12345`.

- [x] Made `back` follow shell pathing
      Deliverable: `back` now unwinds one level at a time, so an instance-bound prompt returns to `robotick:studio>`, then `robotick>`.

- [x] Started presenting context like a path
      Deliverable: the shell now treats context-forming entries more like directories, especially in `ls`, so namespace/scope changes are easier to distinguish from executable actions.

- [x] Clarified strict `studio` context semantics
      Deliverable: the design now says plain `studio` exposes `open` as an action rather than a context; project context is deferred until it is genuinely bound inside an already open Studio session.

- [x] Migrated shell implementation to session folders
      Deliverable: after `open` succeeds, the shell stays at `robotick:studio>`, reports the new session folder such as `studio-12345/`, `ls` presents that folder as an enterable context, and tests cover the new folder/file contract.

- [x] Separated shell exit from Studio quit
      Deliverable: the design now treats `exit` as leaving the Robotick CLI, `back` as moving to the parent shell context, and `quit` as closing the currently bound Studio session.

- [x] Started catch-up CLI contract tests
      Deliverable: automated CLI tests now cover current shell/path behavior, including `ls` context/action presentation, quiet empty/project open flows, `instances`, `cd` into discovered session folders, `back` unwinding, clean `quit`, and stale-session cleanup.

- [x] Clear stale session context after Studio closes
      Deliverable: when a bound Studio session exits, the shell drops from `robotick:studio:studio-12345>` back to `robotick:studio>`, removes the stale `studio-12345/` context from `ls`, prints a short notice, and does not leave stale bound context behind.

- [x] Remove fixed-port footguns from repeated dev launches
      Deliverable: repeated `open` calls no longer collide on a hard-coded Electron devtools port, and the dev-mode launch path now allocates a per-launch remote-debugging port.

- [x] Improve close/shutdown ergonomics before full lifecycle work
  Deliverable: `quit` now targets the detached Studio process group rather than only the wrapper pid, gives a concise Robotick-level close result, waits briefly for clean process-group exit, clears the session folder on success, and surfaces incomplete shutdown as a quiet, explicit message instead of raw child-process spam.

- [x] Split create from open and make open the first composite command
      Deliverable: `create` is now the primitive session-creation command that reports the new `studio-12345/` folder without changing context, while `open` is now the convenience composite that creates a session and immediately binds to it in the immediate shell.

- [ ] Make Studio itself exit cleanly under normal quit paths
      Deliverable: closing a Studio session no longer routinely stalls on launcher/websocket/background-task shutdown; normal `quit` paths should complete without leaving lingering `concurrently`, `vite`, or launcher processes behind, and the root shutdown blockers should be understood and fixed in Studio rather than only papered over in the CLI.

- [ ] Add session metadata/status polish
      Deliverable: `ls` and `instances` show lightweight metadata such as current project, mode, and launch age so the new session-folder model remains discoverable once more than one Studio session exists.

- [ ] Add graceful Studio-API-backed quit when available
      Deliverable: once a local Studio control endpoint exists, `quit` prefers a real in-app close request before falling back to process signalling, so shutdown state can be reported more accurately than pid polling alone.

#### How It Is Looking For Agentic UX

The shape is now materially better for agentic use. The CLI exposes an explicit resource lifecycle: create a Studio session, discover the reusable session folder, bind to it, and close it. That is easier for an agent to reason about than the earlier auto-bound shell because creation, navigation, and action are now separate concepts with separate tests. Splitting `create` from composite `open` should improve that further by making the primitive contract scriptable while still giving humans a concise default workflow. The remaining weakness is not the shell grammar; it is the lack of a richer Studio control API behind `quit`, project binding, and readiness, which is why the next work should stay focused on lifecycle/control contracts rather than more prompt polish.

### MVP

Goal: make launch -> ready -> snapshot -> stop -> quit obvious, deterministic, and reliable for humans and external automation.

- [ ] Define MVP Studio command/state contract
      Deliverable: documented app, project, launcher, readiness, capture, and shutdown state.

- [ ] Implement instance discovery and targeting
      Deliverable: `robotick studio instances`, stable session folder names, optional targeting flags where still useful, and `ls` support for presenting discovered Studio sessions as enterable contexts.

- [ ] Implement bound interactive mode
      Deliverable: `robotick studio` opens a REPL that can bind to an instance and run repeated commands without `--instance`.

- [ ] Implement project switching
      Deliverable: `robotick studio <session> project <project>` and bound-session `project ...` flows can bind/switch project state explicitly with clear success/failure reporting.

- [ ] Continue expanding CLI shell/unit/integration test coverage
      Deliverable: every new command/state permutation is added test-first or test-alongside, including one-shot vs immediate-mode equivalence, quiet vs attached open flows, close/quit lifecycle behavior, future instance discovery/binding, and invalid context/action combinations.

- [ ] Implement launcher commands
      Deliverable: `robotick studio <session> launcher launch`, `stop`, `status --json`, and `wait-ready` work consistently in one-shot and bound-session forms.

- [ ] Implement readiness state
      Deliverable: machine-readable state distinguishing launch requested, launching, running, healthy, degraded, and failed.

- [ ] Implement workspace/viewer readiness for capture workflows
      Deliverable: active workspace, selected viewer option, receive/present metrics where relevant, and degraded/not-trustworthy state.

- [ ] Implement first-class capture
      Deliverable: `robotick studio <session> capture panel ...` writes predictable output plus metadata.

- [ ] Fix shutdown sequencing
      Deliverable: `robotick studio <session> quit --wait`, staged shutdown state, blocker diagnostics, and terminal/log reconnect suppression during quit.

- [ ] Make the flow self-describing
      Deliverable: a cold operator or bot can discover the canonical flow from `README.md`, `AGENTS.md`, `robotick.yaml`, and `robotick studio --help`.

### Success Criteria

The Barr.e baseline should become:

```bash
robotick studio open
robotick studio studio-12345 project barr-e
robotick studio studio-12345 launcher launch --profile local:ALL
robotick studio studio-12345 launcher wait-ready --workspace remote-control
robotick studio studio-12345 capture panel --workspace remote-control --panel main --out artifacts/...
robotick studio studio-12345 launcher stop
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
launcher launch --profile local:ALL
launcher wait-ready --workspace remote-control
capture panel --workspace remote-control --panel main --out artifacts/...
launcher stop
quit
```

The equivalent MCP workflow should complete without repo rummaging, script-path discovery, UI selector discovery, visual-state guessing, or log scraping for basic operational truth.

### Future Work

- [ ] Artifact/output conventions once capture workflows settle
- [ ] Richer log inspection and tailing commands
      Deliverable: explicit log viewing/tailing commands beyond the current `--attach` launch mode
- [ ] Richer `workspace`, `viewer`, `diagnostics`, `capture`, and child-window coverage
- [ ] MCP adapter over the same operational contract
- [ ] Broader telemetry/model inspection commands
- [ ] Stronger visibility/focus/window-state introspection
- [ ] Python or other scripting client over the same contract
