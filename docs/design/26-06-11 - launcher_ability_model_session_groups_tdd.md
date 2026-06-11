# Launcher Ability And Model Session Groups Technical Design

Date: 2026-06-11

Status: Proposed long-term architecture

Related docs:

- `docs/design/26-06-05 - robotick_cli_and_agentic_ux.md`
- `docs/design/26-03-28 - robotick_studio_telemetry_routing_plan.md`

## Executive Summary

Hub should be the stable control plane for Studio, CLI, MCP, and other agentic clients. Launcher-specific behavior should live behind a hub `ability`, not in hub core.

The execution model should be based on:

- `model_session`: one running, starting, stopped, or failed model runtime.
- `model_session_group`: an aggregate of model sessions created from `ALL`, a named profile, an explicit model list, or a single model.
- `ALL`: the canonical everything scope. There should be no separate `whole_robot` primitive; a full robot is simply a model session group whose scope expands to all relevant models.

The long-term goal is reliable independent runtimes. Multiple robots, projects, targets, or profiles should be able to run in parallel from separate Studio instances, one Studio instance, `robotick-cli`, MCP, or another hub client. Switching project in Studio should discover and bind to matching running groups without stopping or disturbing unrelated bots.

## Terms

- `hub core`: request routing, auth/context, workspace discovery, ability registration, and shared transport concerns.
- `ability`: a bounded hub extension that knows how to talk to an external domain or service.
- `launcher ability`: the hub ability that owns launcher semantics, launch planning, model session groups, model sessions, and runtime handoff.
- `launcher worker`: a short-lived or long-lived process used by the launcher ability to start, stop, or recover model runtimes.
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
- creating and tracking model session groups
- creating and tracking model sessions
- starting launcher workers
- handing runtime observation to direct robot endpoints
- reducing per-model status into group status
- exposing resources to Studio, CLI, MCP, and other hub clients

Launcher workers should not be the long-term source of runtime truth. Once a model is up, Studio and hub should prefer direct runtime observation through `robotick-engine` health, telemetry, and future control endpoints.

## CLI And Hub Control Surface

CLI and hub launcher controls should be implemented as the first practical surface over this resource model. Any legacy "launcher run" concept should map to `model_session_group`, with per-model detail represented by `model_session`.

The practical command shape becomes:

- `launch`: create a model session group from launch intent, then return the group id, resolved scope, target/stage policy, member model session ids, and creator metadata.
- `wait-ready`: wait for a group or session to reach live-confirmed readiness, while reporting service-level readiness separately from runtime readiness.
- `status`: report ability health, group status, and per-session lifecycle without relying on ambient singleton launcher state.
- `logs`: return launcher worker, build, startup, and runtime log references scoped to a group or session.
- `stop`: stop a selected model session, a selected set of sessions, or every member of a group.
- `restart`: restart one session or aggregate over a group by creating a new generation for each selected model.

For compatibility during migration, responses may expose `launcher_run_id` as an alias for `model_session_group.id`. New clients should prefer `model_session_group_id` and `model_session_id`.

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
    "client": "studio | robotick-cli | mcp | other",
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
  "desired_runtime": {
    "telemetry": true,
    "control": true
  }
}
```

The launcher ability resolves this intent into a model session group plus concrete model sessions. Hub core only routes the request to the ability and returns the resulting resources.

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
- `robotick-cli` and MCP can launch, inspect, stop, and restart the same resources Studio sees.
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

This does not require arbitrary third-party plugins immediately, but the architecture should make built-in abilities look like future external abilities could use the same shape.

## Migration Plan

1. Define the launcher ability resource contracts for launch intent, model session group, and model session.
2. Add compatibility mapping from current profile strings such as `local:ALL` and `native:alf-e-spine` into launch intent.
3. Introduce durable group/session envelopes while preserving existing launcher endpoints.
4. Add runtime probes and handoff status using `robotick-engine` endpoints.
5. Decouple Studio project selection from launcher process ownership.
6. Replace singleton-shaped launcher listener state with per-group/per-session state.
7. Implement CLI commands as group/session operations rather than ambient launcher-run operations.
8. Expose the same resources through Studio UI, `robotick-cli`, and MCP.
9. Remove or deprecate legacy status endpoints once clients use the resource model.

## Acceptance Criteria

- Multiple robots/projects can run independently at the same time from separate Studio instances.
- Multiple robots/projects can run independently at the same time from one Studio instance.
- Multiple robots/projects can run independently at the same time from `robotick-cli`, MCP, or another hub client.
- Studio project switching discovers and binds to matching existing model session groups without stopping or disturbing other running bots.
- `ALL`, profile, explicit model list, and single model launches all resolve to model session groups.
- Individual models can be stopped and restarted without stopping the whole group.
- Group stop/restart works as aggregate operations over member model sessions.
- Runtime state after handoff is confirmed directly from `robotick-engine` where available.
- Persisted state is never presented as live unless it has been recently confirmed.
- `robotick launcher launch`, `wait-ready`, `status`, `logs`, `stop`, and `restart` operate on model session groups and model sessions.
- Service-level readiness is reported separately from group/session runtime readiness.
- Per-model build, launch, runtime, and failure details are agent-accessible without attaching to terminals manually.
- Existing launcher status and ensure flows remain compatible during migration.

## Open Decisions

- Exact storage location for durable group/session envelopes.
- Whether the launcher ability runs fully in hub process or delegates to a separate internal service.
- Final target override schema for mixed local, native, remote, container, and embedded launches.
- How dependency expansion should work when launching a subset of models.
- Teardown behavior for runtimes that do not expose `robotick-engine` control endpoints.
