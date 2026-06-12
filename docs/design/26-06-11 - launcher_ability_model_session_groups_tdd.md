# Launcher Ability And Model Session Groups Technical Design

Date: 2026-06-11

Status: Proposed long-term architecture

Related docs:

- `docs/design/26-06-05 - robotick_cli_and_agentic_ux.md`
- `docs/design/26-03-28 - robotick_studio_telemetry_routing_plan.md`

## Executive Summary

Hub should be the stable control plane for Studio, CLI, and other agentic clients. Launcher-specific behavior should live behind a hub `ability`, not in hub core.

The execution model should be based on:

- `model_session`: one running, starting, stopped, or failed model runtime.
- `model_session_group`: an aggregate of model sessions created from `ALL`, a named profile, an explicit model list, or a single model.
- `ALL`: the canonical everything scope. There should be no separate `whole_robot` primitive; a full robot is simply a model session group whose scope expands to all relevant models.

The long-term goal is reliable independent runtimes. Multiple robots, projects, targets, or profiles should be able to run in parallel from separate Studio instances, one Studio instance, `robotick-cli`, or another hub client. Switching project in Studio should discover and bind to matching running groups without stopping or disturbing unrelated bots.

## MVP Simplification: Per-Model Runtime Authority

Status update, 2026-06-12: for the CLI-only MVP, model-session groups are no longer the active launcher control primitive. They may remain as diagnostic/history records while existing worker/log machinery depends on them, but current state and control should be shaped around project/model runtime records.

The MVP rule is:

- hub stores a small per-model runtime phone book keyed by project plus model id
- hub verifies phone-book entries against live process and telemetry signals before presenting state
- in-flight launcher operations are tracked per model as `launching`, `stopping`, or `restarting`
- whole-project launch, stop, and restart expand to the selected project models and fan out in parallel
- Studio and CLI compute aggregate toolbar/status state from granular per-model runtime records
- stale historical session/group records must not decide current running/stopped/flatline state

The active MVP control endpoints are:

- `POST /v1/launcher/models/launch`
- `POST /v1/launcher/models/stop`
- `POST /v1/launcher/models/restart`
- `GET /v1/launcher/runtime`
- `GET /v1/launcher/status`, with `runtime.models` as the current-state source of truth

`ALL` remains a selector meaning “expand to all selected launchable models”; it is not a separate long-lived runtime group. Restart remains simple stop-plus-launch behavior.

## Terms

- `hub core`: request routing, auth/context, workspace discovery, ability registration, and shared transport concerns.
- `ability`: a bounded hub extension that knows how to talk to an external domain or service.
- `launcher ability`: the hub ability that owns launcher semantics, launch planning, model session groups, model sessions, and runtime handoff.
- `launcher worker`: a short-lived or long-lived process used by the launcher ability to start, stop, or restart model runtimes.
- `model_session`: the durable resource representing one concrete model runtime attempt.
- `model_session_group`: the durable resource representing a requested aggregate of model sessions.
- `handoff`: the point where startup supervision moves from launcher worker state to direct runtime observation.
- `runtime authority`: the service that owns live runtime truth after handoff, normally `robotick-engine`.
- `last_known`: persisted state that has not yet been confirmed against the runtime authority.
- `stale`: state whose last live confirmation is older than the accepted freshness window.

## Problem

The current launcher path is useful but too coupled to a single active launcher shape:

- Profile strings combine launcher mode, target choice, and scope into values such as `local:ALL` or `native:alf-e-spine`.
- Studio selection, launcher listener state, and status presentation are closely coupled.
- Some launcher state is effectively singleton-shaped, which makes independent multi-project and multi-robot operation harder to reason about.
- Hub has routes for workspace, Studio, and launcher operations, but no durable ability/resource boundary for launcher-owned concepts.

This blocks the desired operating model where Studio is a viewer/controller of independent runtimes rather than the owner of those runtimes.

## Current Code Map

Implementation should assume the current code is split this way:

- Hub composition: `tools/robotick-hub/src/robotick_hub/app.py` directly wires workspace, Studio, and launcher routes.
- Historical note: the earlier standalone launcher hub provider has now been retired; launcher control is owned directly by the hub-hosted launcher ability and `/v1/launcher/*` resources.
- Studio hub provider: `tools/robotick-hub/src/robotick_hub/studio.py` manages Studio instance records, launch/quit, control endpoint registration, project selection, and activation.
- Launcher listener: `tools/robotick-launcher/src/robotick/launcher/listen/routes_launch.py` owns singleton module-level runtime state such as process handle, current profile, current project, current status, log subscribers, and status queue.
- Launcher query listener: `tools/robotick-launcher/src/robotick/launcher/listen/routes_query.py` serves workloads registry, model schema, and related project/query helpers still reached through hub proxy routes.
- Launcher domain logic: `tools/robotick-launcher/src/robotick/launcher/actions/launch/run_profile.py` and `target_plan.py` contain much of the useful profile, model, target, stage, build, deploy, run, and stop behavior to preserve.
- Studio renderer launcher data source: `src/renderer/data-sources/launcher/internal/launcher-interface.ts` now calls `/v1/launcher/models/*` for control and `/v1/launcher/status` for live per-model runtime projection. Dedicated Studio log streaming is still follow-on work.
- CLI launcher entrypoint: `tools/robotick-cli/src/robotick_cli/launcher.py` now exposes `launch`, `status`, `wait-ready`, `logs`, `stop`, `restart`, and a resource-native `ensure`.

The first implementation step should be to split reusable domain logic from listener state so hub abilities can import domain behavior without starting the singleton listener.

## Current Behavior To Preserve

The replacement architecture should preserve the useful behavior already present:

- `ALL` expands to all launchable models for a project.
- Named profiles can select a meaningful subset of models.
- Explicit model launch can ignore `auto_launch=false`; profile and `ALL` launch should respect it.
- `local` can force Linux execution; `native` can honor each model's configured target platform and variant.
- Individual models can be started, stopped, and restarted.
- Target planning supports platform, variant, custom stages, remote strategies, container strategies, and host/deploy settings.
- `robotick-engine` exposes telemetry and health-style endpoints that can be used directly after launch.

## Target Architecture

Hub core composes abilities. It should not resolve launcher-specific scopes, target overrides, model ids, or runtime status itself.

The launcher ability owns:

- parsing launch intent
- resolving project/profile/model scope
- resolving target and stage policy
- serving launcher-owned project query/schema resources that currently sit behind the listener
- creating and tracking model session groups
- creating and tracking model sessions
- starting launcher workers
- handing runtime observation to direct robot endpoints
- reducing per-model status into group status
- exposing resources to Studio, CLI, and other hub clients

Launcher workers should not be the long-term source of runtime truth. Once a model is up, Studio and hub should prefer direct runtime observation through `robotick-engine` health, telemetry, and future control endpoints.

## Ability Architecture

Launcher should be implemented as one built-in hub ability, not as a special case. Existing hub integrations, including Studio communication, should move toward the same shape so the ability boundary becomes a real architectural seam.

Current implementation clarification:

- `robotick-hub` now exposes a built-in ability seam with manifest/status metadata, shared hub context, and route registration.
- Studio and Launcher are both mounted through that same built-in ability shape.
- Launcher ability ownership now lives under `tools/robotick-launcher/src/robotick/launcher/hub_ability/`.
- Studio ability ownership now lives under `tools/robotick-studio-ability/src/robotick/studio_ability/hub_ability/`.
- Hub core now only composes those owner-packaged abilities plus shared contracts/context/workspace helpers.
- The default shape for a simple built-in ability is a single `ability.py` entrypoint plus only the support modules that carry real domain weight.
- Launcher currently uses `ability.py` plus focused support modules such as `launcher_sessions.py` and worker entrypoints.
- Studio currently uses `hub_ability/ability.py` plus `domain.py`.

An ability should provide:

- a stable name and version
- health/status metadata
- route/resource registration
- typed request and response contracts
- access to shared hub context such as workspace lookup, request identity, logging, and storage helpers
- clear ownership of its domain rules
- tests for its contracts and status behavior

Hub core should not know the internals of any specific ability. It should compose abilities, expose their metadata, route requests to them, and provide shared infrastructure.

Built-in abilities should use the same conventions future external plugins would need. This does not require dynamic plugin loading immediately, but it should avoid patterns that would make plugin loading difficult later, such as hidden globals, direct cross-ability imports, or domain logic embedded in hub route handlers.

Launcher and Studio now run as built-in hub abilities imported from their owner packages. Their endpoint shapes and shared built-in ability conventions still keep the door open for future plugin-style loading without further contract changes, without forcing extra file splits for otherwise simple abilities.

Target launcher package shape:

```text
tools/robotick-launcher/
  src/robotick/launcher/
    domain/
    workers/
    hub_ability/
      ability.py
      launcher_sessions.py
```

Target Studio package shape:

```text
tools/robotick-studio-ability/
  src/robotick/studio_ability/
    domain.py
    hub_ability/
      ability.py
```

Packaging note:

- local source-tree development now relies on the shared `robotick` top-level package being namespace-friendly so launcher-owned and Studio-owned modules can live in separate `src` roots without shadowing each other.

## Process Boundaries

The launcher should stop being a standalone singleton service. The long-term process model should be:

- `robotick-hub`: a long-running process that hosts the launcher ability in-process as Python application code.
- Launcher ability internals: normal Python modules/classes called by hub routes for intent parsing, scope resolution, target planning, storage, status reduction, and runtime probing. These now live in `tools/robotick-launcher`.
- Launcher domain helpers: importable Python code split away from listener route state so hub can reuse profile, target planning, query/schema, and status-reduction behavior without starting a listener service.
- Launcher workers: separate child processes only when needed to run build, flash, deploy, start, stop, or restart commands for specific model sessions or groups.
- `robotick-engine`: separate runtime process on the target host/device. After handoff, it is the live runtime authority for health, telemetry, and future control.
- Studio: separate UI/application process that discovers and controls groups/sessions through hub, and may continue to read runtime telemetry directly where that is the best data path.
- `robotick-cli`: short-lived command process that talks to hub over the JSON API rather than importing launcher internals.
This keeps hub as the control plane, launcher ability as internal domain logic, launcher workers as execution helpers, and `robotick-engine` as runtime truth.

Current implementation clarification:

- Launcher group creation now happens in-process inside the hub-hosted launcher ability.
- Per-session launch currently uses hub-managed worker subprocesses rather than a standalone launcher listener service.
- Group/session stop and restart now dispatch the control step through dedicated launcher worker subprocesses, while startup continues to use per-session run workers.
- Group status is now reduced from the latest session generation per model, so restart history does not poison current aggregate state.

## CLI And Hub Control Surface

CLI and hub launcher controls should be implemented as the first practical surface over this resource model. Older "launcher run" terminology should be retired in favor of project/model runtime control, with model sessions retained as diagnostic execution records.

The practical command shape becomes:

- `launch`: resolve a project/model selector, fan out selected model launches, and return launched/skipped model ids plus runtime projection.
- `wait-ready`: wait for selected runtime readiness, while reporting service-level readiness separately from runtime readiness.
- `status`: report ability health and per-model runtime lifecycle without relying on ambient singleton launcher state.
- `logs`: return launcher worker, build, startup, and runtime log references scoped to available diagnostics.
- `stop`: stop a project, explicit model, or explicit model set by fan-out across the selected models.
- `restart`: simple stop-plus-launch for a project, explicit model, or explicit model set.

Current implementation clarification:

- `robotick launcher launch`, `status`, `wait-ready`, `logs`, `stop`, and `restart` now exist as JSON-first CLI commands over the hub-hosted launcher ability.
- `launch`, `stop`, and `restart` use `/v1/launcher/models/*`; group/session records are diagnostic/history scaffolding in the MVP path.
- Launcher group/session responses now include hardened convenience fields such as `resolved_scope`, `target_policy`, `stage_policy`, `creator`, `freshness`, `actionable_diagnostics`, and per-session `log_refs`, so Studio and CLI do not need to reconstruct those views independently.
- `wait-ready` now benefits from launcher refresh logic that hands sessions off to runtime authority when live health succeeds, and reduces them to `stale` when live confirmation ages out.
- `logs` now exposes launcher worker/control log references plus runtime probe references from the stored session runtime metadata.
- Studio now discovers launcher state from the per-model runtime projection in `/v1/launcher/status`, rather than by binding to a hidden singleton launcher process owned by the renderer.

## Resource Model

`model_session_group` should contain enough information to reconstruct the requested aggregate without relying on Studio state:

```json
{
  "id": "msg_...",
  "workspace_id": "robotick-knitware",
  "project_id": "alf-e",
  "project_path": ".../robots/alf-e/robotick.yaml",
  "scope": {
    "kind": "ALL | profile | models | model",
    "value": "ALL"
  },
  "resolved_model_ids": ["alf-e-face", "alf-e-spine"],
  "target_policy": "native",
  "stage_policy": "default",
  "created_by": {
    "client": "studio | robotick-cli | other",
    "instance_id": "..."
  },
  "status": "starting | running | degraded | stopped | failed | stale",
  "sessions": ["ms_...", "ms_..."]
}
```

`model_session` should represent one concrete model runtime attempt:

```json
{
  "id": "ms_...",
  "group_id": "msg_...",
  "project_id": "alf-e",
  "model_id": "alf-e-spine",
  "generation": 3,
  "target": {
    "platform": "esp32",
    "variant": "esp32s3_m5",
    "host": "..."
  },
  "lifecycle": "planned | starting | handed_off | running | stopping | stopped | failed | stale",
  "runtime": {
    "authority": "robotick-engine",
    "telemetry_url": "http://...",
    "health_url": "http://..."
  },
  "last_confirmed_at": "2026-06-11T12:00:00Z"
}
```

## Launch Intent

Clients should submit launch intent rather than pre-resolved launcher internals:

```json
{
  "project": "alf-e",
  "scope": {
    "kind": "ALL | profile | models | model",
    "value": "ALL"
  },
  "target_policy": "native",
  "target_overrides": {
    "alf-e-spine": {
      "platform": "esp32",
      "variant": "esp32s3_m5"
    }
  },
  "stage_policy": "default",
  "dependency_policy": "exact",
  "desired_runtime": {
    "telemetry": true,
    "control": true
  }
}
```

The launcher ability resolves this intent into a model session group plus concrete model sessions. Hub core only routes the request to the ability and returns the resulting resources.

First implementation clarification:

- `target_overrides` is a per-model mapping with optional `platform`, `variant`, `host`, and `stages`.
- `stage_policy` remains the global default; explicit stage lists can be supplied globally or per model override.
- `dependency_policy=exact` means explicit subset launches do not implicitly expand dependency graphs in the first implementation.

## First Storage Shape

The first durable store should be workspace-local JSON envelopes under:

- `.robotick/launcher/model-session-groups/<group-id>.json`
- `.robotick/launcher/model-sessions/<session-id>.json`

This keeps the first resource model inspectable and easy to migrate while contracts and lifecycle behavior are still moving. A future migration to SQLite or another indexed store remains possible once the resource and API shapes are stable.

## Lifecycle

Model session groups are aggregates. Their status should be derived from member model sessions, not stored as independent truth.

Suggested group status reduction:

- `starting`: at least one required model is starting and none have failed.
- `running`: all required models are live-confirmed.
- `degraded`: at least one required model is failed, stopped, or stale while at least one model remains running.
- `stopped`: all member sessions are stopped.
- `failed`: no member sessions are running and at least one failed.
- `stale`: no member session has current live confirmation.

Model sessions should track lifecycle per runtime attempt. Restarting a model creates a new generation for the same logical model session or a replacement session linked to the previous one. The implementation can choose the storage shape, but clients need a stable way to distinguish "same model restarted" from "different model".

## Independent Runtime Ownership

Runtime ownership must be independent of Studio selection.

Required behavior:

- Separate Studio instances can launch separate projects or separate target/profile combinations without colliding.
- One Studio instance can switch projects and discover existing matching model session groups.
- Switching project in Studio must not stop, replace, or hide unrelated running groups.
- `robotick-cli` can launch, inspect, stop, and restart the same resources Studio sees.
- Two clients viewing the same group should observe the same live runtime state.

Studio should act like a controller and viewer. It may request launch or stop operations, but it should not be the hidden owner of process lifetime.

## Handoff And Runtime Probes

After a model launches, runtime state should be queried from the runtime authority where possible.

For `robotick-engine`, the launcher ability can use:

- telemetry freshness as the strongest signal that the runtime is alive and useful
- `/api/telemetry/health` or `/health` as a lightweight probe when available
- telemetry layout and raw endpoints for richer model/runtime identity checks

Launcher worker state is still useful during startup, failure, and teardown, but it should not be the only source of truth after handoff.

Persisted state should be explicit about freshness:

- Fresh live probe: report live status.
- No recent probe: report `last_known` plus stale age, or reduce to `stale`.
- Conflicting launcher and runtime signals: prefer runtime authority after handoff, and include diagnostics.

## Stop And Restart Semantics

Stop and restart should be model-scoped first:

- Stop one model session without stopping the rest of the group.
- Restart one model session without rebuilding the whole group.
- Stop a group by stopping every member session in the group.
- Restart a group by restarting every selected member session, preserving the group identity where practical.

This keeps full robot behavior as an aggregate operation over `ALL` rather than a separate primitive.

## Hub And Ability Boundary

Hub core should provide a small, stable set of ability integration points:

- register ability metadata
- mount ability routes/resources
- provide workspace/project lookup helpers
- provide shared client identity and request context
- expose ability health/status

The launcher ability should own launcher domain rules. That includes scope expansion, profile semantics, target planning, startup orchestration, runtime handoff, and model/group status reduction.

Current implementation clarification:

- Scope expansion, profile semantics, target planning, storage, startup orchestration, and status reduction now route through shared launcher domain modules plus the launcher ability.
- Runtime handoff/probing now also runs behind the launcher ability boundary, including direct `robotick-engine` health confirmation, stale-state reconciliation, and persisted source-of-truth diagnostics.

This does not require arbitrary third-party plugins immediately, but the architecture should make built-in abilities look like future external abilities could use the same shape.

## Validation Strategy

The implementation does not need to be purely test-first, but each layer should be validated before the next layer depends on it.

Required coverage shape:

- Unit tests for launch intent mapping, scope expansion, target/stage planning, lifecycle transitions, status reduction, freshness, and stop/restart selection.
- Contract tests for hub and CLI JSON payloads, including success, failure, stale state, and invalid selection cases.
- Integration tests for process/runtime behavior that cannot be proven in pure unit tests, especially independent parallel groups and Studio project switching.
- Regression tests for `ALL`, named profiles, explicit model lists, single-model launches, and `auto_launch=false` behavior.
- Focused runtime probe tests for `robotick-engine` health/telemetry handoff and stale-state handling.

Temporary launcher disruption is acceptable during the refactor. Untested state transitions, ambiguous readiness payloads, or unvalidated multi-session behavior are not.

## Implementation Route

1. Define the launcher ability resource contracts for launch intent, model session group, and model session.
2. Represent currently supported profile strings such as `local:ALL` and `native:alf-e-spine` as launch intent values.
3. Split reusable launcher domain helpers away from singleton listener route state.
4. Introduce durable group/session storage and route launcher operations through it.
5. Move launcher-backed query/schema routes into hub-owned ability/workspace code.
6. Add runtime probes and handoff status using `robotick-engine` endpoints.
7. Decouple Studio project selection from launcher process ownership.
8. Replace singleton-shaped launcher listener state with per-group/per-session state.
9. Implement CLI commands as project/model runtime operations rather than ambient launcher-run operations.
10. Expose the same resources through Studio UI and `robotick-cli`.
11. Remove legacy ambient status/control paths once the group/session resource model is in use.

The fastest implementation route may make the current launcher temporarily unusable while hub, CLI, and Studio are moved onto hub-hosted launcher resources. The target design does not require compatibility shims for legacy launcher-run or ambient singleton endpoints.

Current implementation clarification:

- Legacy `/launcher/*` singleton control routes have now been removed from hub; callers should use `/v1/launcher/models/*`, `/v1/launcher/runtime`, and `/v1/launcher/status` for current control/state.
- Group/session routes remain diagnostic/history resources while model-log and model-wait surfaces mature.
- Runtime probe/handoff status is now persisted directly on model sessions, with runtime authority taking precedence over launcher worker state after successful live confirmation.
- `robotick launcher ensure` now ensures hub availability, then reads `/v1/launcher/status`; it no longer depends on a separate launcher capability ensure route.

## Acceptance Criteria

- Multiple robots/projects can run independently at the same time from separate Studio instances.
- Multiple robots/projects can run independently at the same time from one Studio instance.
- Multiple robots/projects can run independently at the same time from `robotick-cli` or another hub client.
- Studio project switching discovers and binds to matching existing per-model runtime records without stopping or disturbing other running bots.
- `ALL`, profile, explicit model list, and single model launches all resolve to selected project/model runtime operations.
- Individual models can be stopped and restarted without stopping unrelated models.
- Whole-project stop/restart works as parallel fan-out over selected models.
- Runtime state after handoff is confirmed directly from `robotick-engine` where available.
- Persisted state is never presented as live unless it has been recently confirmed.
- `robotick launcher launch`, `wait-ready`, `status`, `logs`, `stop`, and `restart` operate on hub-hosted launcher resources, with current state derived from per-model runtime truth.
- Service-level readiness is reported separately from group/session runtime readiness.
- Per-model build, launch, runtime, and failure details are agent-accessible without attaching to terminals manually.
- Legacy ambient launcher status/control paths are removed or replaced by model runtime resources.

## Open Decisions

- Whether the JSON envelope store should later migrate to SQLite or another indexed store after the contracts stabilize.
- Whether mixed-target overrides need fields beyond `platform`, `variant`, `host`, and `stages`.
- Teardown behavior for runtimes that do not expose `robotick-engine` control endpoints.
