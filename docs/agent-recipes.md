# Robotick Studio Agent Recipes

Purpose: give agents a Studio-local index of common workbench names, resource paths, and repeatable CLI workflows.

Use this file when:

- a user uses shorthand such as `Rc`, `Telemetry`, or `Terminal`
- a user says `studio` and expects the default operator workbench
- a request implies a Studio context but does not provide the exact resource path
- you need a default Studio workflow that is more specific than the workspace-level recipe index

Ground rules:

- prefer live Studio instance status over file-backed assumptions once an instance exists
- use project-backed Studio config only as a pre-launch fallback
- keep entries focused on user intent to CLI/runtime mapping
- treat `status` as read-only; it does not start services
- use `hub ensure` and `launcher ensure` only when service startup or reuse is actually required

## Launcher Recipes

### Inspect launcher runtime for the active workspace

```bash
./tools/robotick launcher status
```

Use this before action commands when the user asks about currently running models. Treat the per-model runtime section as source of truth.

### Inspect current Studio focus

```bash
./tools/robotick studio focused
```

Use this when the user asks what they are looking at in Studio, says `:studio`, or asks about the current Studio context. The command is read-only. It reports the currently focused Studio instance/window when one has desktop focus; otherwise it falls back to the most recently focused Studio instance and reports the active window/workbench/layout. Panel and element focus are intentionally future extensions.

Prefer `:studio` as the agent shorthand. Avoid `@studio` in VS Code chat because VS Code may resolve it as the repository `studio` folder instead of leaving it as Robotick shorthand.

### Compare hub runtime authority with Studio-facing launcher state

```bash
./tools/robotick studio launcher-status <project>
```

Use this during launcher/Studio debugging to compare raw hub per-model runtime truth with the state Studio-facing code will consume. `comparison.state_agrees` should be `true`; inspect the per-model entries if hub and Studio disagree about `running`, `stopped`, or operation state.

### Launch a whole project through the hub-hosted launcher ability

```bash
./tools/robotick launcher launch <project> native:ALL
```

Use `native:<profile>` for a named profile, or `--model` / `--models` plus `--local` or `--native` for explicit model selection.

### Wait for launcher readiness, inspect logs, and stop model selections

```bash
./tools/robotick launcher wait-ready --project <project>
./tools/robotick launcher logs --project <project>
./tools/robotick launcher stop --project <project>
```

Use `--model <id>` or `--models <id,...>` for per-model/subset control. Whole-project control is model fan-out, not a first-class group operation.

### Restart model shorthand in the current Studio project

When a user asks to restart bare model names in `:studio`, first resolve the current Studio project, then prefix bare names with the project id to form model ids.

```bash
./tools/robotick studio focused
./tools/robotick launcher restart --project <project> --model <project>-<model-name>
./tools/robotick launcher wait-ready --project <project> --model <project>-<model-name>
```

For multiple models:

```bash
./tools/robotick studio focused
./tools/robotick launcher restart --project <project> --models <project>-<model-a>,<project>-<model-b>
./tools/robotick launcher wait-ready --project <project> --models <project>-<model-a>,<project>-<model-b>
```

Example: if `studio focused` reports `project_name: "pip-e"`, then "restart face and mind" means `--models pip-e-face,pip-e-mind`. Report the readiness result after `wait-ready`, including any model that does not return `running`, `ready`, and `live`.

### Inspect Studio Terminal log sources without opening Terminal

```bash
./tools/robotick launcher logs --project <project> --tail 200
./tools/robotick launcher logs --project <project> --model <model-id> --tail 200
./tools/robotick launcher logs --project <project> --models <model-a>,<model-b> --tail 200
```

Use this for agentic log/terminal access. The hub exposes per-model/per-source log channels such as `launcher-worker`, `launcher-control`, and `model-runtime`; Studio Terminal aggregates those channels for display and labels each line with model id plus source kind. Hub and Studio process logs are intentionally separate diagnostics and are not included in the Terminal aggregation by default.

### Verify whether a model YAML edit reached the running engine

```bash
stat -c '%y %n' robots/<project>/models/<model>.model.yaml robots/<project>/.launcher/<project_slug>/generated/<model_slug>/linux/<model_slug>_model.cpp robots/<project>/.launcher/<project_slug>/generated/<model_slug>/linux/build/<model>
./tools/robotick launcher logs --project <project> --model <model-id> --tail 220
```

Use this when a restarted model appears stale in-engine. Restart is stop-plus-launch through the launcher ability; launch runs generation/build/deploy/run for the selected model. If the model YAML timestamp is newer than the generated source or built binary, restart has not run after the latest edit. The launcher log should show generation, build, and engine load lines for the session that Studio is currently using.

## Workbench Glossary

These are the current common main-window workbench ids used in Studio project documents.

### `Rc`, `RC view`, or `Remote Control`

- Workbench id: `remote-control`
- Path: `windows main workbenches remote-control`
- Typical use: operator-facing robot control view

### `Studio`

- Default workbench id: `remote-control`
- Path: `windows main workbenches remote-control`
- Typical use: default operator-facing Studio entry when no other workbench is named

### `Telemetry`

- Workbench id: `telemetry`
- Path: `windows main workbenches telemetry`
- Typical use: runtime telemetry inspection

### `Models`

- Workbench id: `models`
- Path: `windows main workbenches models`
- Typical use: model graph inspection

### `Project`

- Workbench id: `project`
- Path: `windows main workbenches project`

### `Terminal`

- Workbench id: `terminal`
- Path: `windows main workbenches terminal`

### `Home`

- Workbench id: `home`
- Path: `windows main workbenches home`

## Recipes

### Open a project directly into a workbench

```bash
./tools/robotick studio open <project> windows main workbenches <workbench-id> activate
```

Example:

```bash
./tools/robotick studio open barr-e windows main workbenches remote-control activate
```

### Open a registered project when the user does not specify a view

```bash
./tools/robotick studio open <project>
```

If the user explicitly asks for `studio` without naming a view, open the project into `remote-control` instead:

```bash
./tools/robotick studio open <project> windows main workbenches remote-control activate
```

Current observed behavior: `studio open <project>` can leave the bound control path on `windows/main/workbenches/terminal` even when the project switch succeeds. If the user expects the operator-facing Studio view, follow with:

```bash
./tools/robotick studio <instance> windows main workbenches remote-control activate
```

Otherwise, do not invent a workbench switch unless a project-specific default is documented.

If `studio open <project>` is run while that project is already locked by a live Studio instance, the command may report a transient new instance that exits after the project-lock conflict. Prefer `./tools/robotick studio instances` first when a project is already open, then target the existing instance directly.

### Verify the active main-window workbench

```bash
./tools/robotick studio <instance> windows main status
```

Check `active_workbench_id` in the JSON result.

### Discover live Studio structure after launch

- Use `./tools/robotick studio instances` to find the running instance id.
- If `studio instances` reports `project_name: null`, use `./tools/robotick studio <instance> status` as the authority for the selected project.
- Use `./tools/robotick studio <instance> windows main status` for main-window structure and active workbench.
- Use bound-instance `ls`, `cd`, and `status` in the immediate shell when interactive exploration is more efficient.

### Resolve a shorthand workbench request before launch

1. Map the user phrase to a workbench id from this file.
2. Open the requested project with `./tools/robotick studio open <project> windows main workbenches <workbench-id> activate`.
3. Verify the active workbench with `./tools/robotick studio <instance> windows main status`.

## Known Gaps

- There is not yet a first-class pre-launch command for listing activatable targets by label or alias.
- There is not yet a first-class capture command or capture-readiness contract.
- `studio instances` may omit the selected project name for a live instance; confirm via per-instance `status`.
- `studio open <project>` may bind the control path to `terminal`, so agent workflows that mean "open Studio" often need an explicit `remote-control activate`.
- Recipe entries here should not be treated as proof of runtime readiness.
- `.robotick/launcher/model-session-groups`, `.robotick/launcher/model-sessions`, and `.robotick/logs/launcher-sessions` are historical/debug accumulation areas, not live runtime truth. Prefer `/v1/launcher/runtime` and model log resources for current status.
