# Robotick Runtime Metrics for Tick Scope Plan

_Started 28 Jun 2026. Working implementation checklist, not a full spec._

## Aim

Tick Scope should stay focused on model/workload timing, but Studio also needs a
generic view of the runtime cost that belongs to a robot model.

First pass:

- CPU usage for the model runtime process tree
- memory usage for the model runtime process tree
- process count and top contributing processes

Tooling costs are out of scope here. Studio/Electron/React profiling remains a
separate tooling-performance concern.

## Planned Shape

Launcher owns measurement because launcher owns the runtime boundary:

- it starts each model runtime
- it knows the model id, session id, root pid, lifecycle, readiness, and health
- it can sample local or remote runtime hosts without asking Tick Scope to infer
  process ownership

Engine telemetry remains the source for:

- workload spans
- engine thread spans
- engine RSS
- workloads-buffer memory

Launcher runtime metrics become the source for:

- full model process-tree CPU
- full model process-tree RSS
- top model-owned processes
- remote runtime host identity
- later device/provider metrics

Studio joins the two by `model_id`.

## Snapshot Sketch

```json
{
  "model_id": "barr-e-simulator",
  "session_id": "ms_...",
  "host": "localhost",
  "sampled_at": "2026-06-28T12:00:00Z",
  "root_pid": 1234,
  "process_group_id": 1234,
  "sample_window_ms": 1000,
  "process_count": 9,
  "cpu_percent": 185.4,
  "rss_bytes": 2401239040,
  "top_processes": [
    {
      "pid": 1235,
      "name": "ign gazebo",
      "cpu_percent": 92.1,
      "rss_bytes": 900000000
    }
  ],
  "devices": []
}
```

`devices` stays empty until provider-specific metrics are added.

## Implementation Checklist

- [x] Add a launcher-side runtime metrics sampler.
  - Input: root pid / process group id / session id.
  - Output: one normalized metrics snapshot.
  - Linux first: read `/proc` directly.

- [x] Track the model-owned process set.
  - Prefer process group or session id when launcher created one.
  - Fall back to descendant traversal from the root pid if needed.
  - Mark snapshots stale/unavailable when the root pid is gone.

- [x] Compute CPU efficiently.
  - Keep previous per-pid CPU counters in launcher state.
  - Use a short remote/local sample window, probably 1s.
  - Report CPU as percent of one core, so multi-core work can exceed 100%.

- [x] Compute memory simply.
  - Sum memory across the selected process set.
  - Include process count and top memory/CPU contributors.

- [x] Expose latest metrics through launcher runtime status.
  - Add a `metrics` field to each model runtime record, or add a sibling
    `/runtime/metrics` endpoint if history/richer payloads make status too heavy.
  - Keep status cheap: latest snapshot only.

- [x] Add CLI access.
  - Example target shape: `./tools/robotick launcher metrics --project barr-e`.
  - Support per-model filtering.
  - Make this usable without Studio.

- [x] Wire Studio data access.
  - Extend the Electron launcher bridge contract.
  - Preserve unknown fields for forward-compatible providers.
  - Avoid polling faster than the sampler cadence.

- [x] Show the data in Tick Scope.
  - Per model card: engine/workload timing remains primary.
  - Add runtime CPU/memory summary from launcher metrics.
  - Show top external processes only when expanded or copied.

- [x] Add engine-side process identity telemetry.
  - Publish `EngineInfo.process_id` with the existing engine runtime stats.
  - Decode it in Studio telemetry models.
  - Use it in Tick Scope as the first join key for engine process metrics.

- [x] Clean up Tick Scope runtime presentation.
  - Engine and other runtime process cards use the same summary shape.
  - Remove redundant debug buttons from the card surface.
  - Move debug JSON copy actions into the panel context menu.
  - Collapse other runtime processes by default.
  - Show `0 other runtime processes` as a single-line empty state.

- [x] Fix container/namespace PID matching.
  - Engine `process_id` is container-visible when the engine runs in Docker.
  - Launcher should publish each sampled host process's PID namespace mapping
    from `/proc/<pid>/status` `NSpid`.
  - Studio should match engine `process_id` against either host PID or namespace
    PID, then use the matched launcher process for host CPU/memory/name.

- [x] Harden launcher runtime rehydration after restarts.
  - Live verification found cases where telemetry health was live but launcher
    runtime status still held a dead worker PID, causing metrics to be `null`.
  - Rehydration should recover the live worker/process tree from current session
    or telemetry ownership rather than preserving stale PIDs.

- [x] Fix custom-stage model build/start expectations.
  - ROS/custom-stage models such as `barr-e-mapping` may not create the standard
    generated `build/<model>` binary that launcher expects.
  - Launcher should not require that placeholder binary when `custom_stages`
    owns build/run, or should create a durable launcher-owned marker explicitly.

- [x] Leave provider slots in the payload.
  - Start with `devices: []`.
  - Preserve unknown fields so later providers can be added without reshaping
    Tick Scope.

## Future Work

- Remote runtime metrics.
  - More complex than local `/proc` sampling because the sampler must run on the
    machine where the model process tree is running.
  - Remote-owned CPU windows should be calculated remotely, not inferred over
    network latency.
  - Local launcher can later request a remote JSON snapshot over the existing
    remote execution/control path.

- Device/provider metrics.
  - Intel NPU usage / memory once there is a concrete host and counter source.
  - GPU usage / memory once there is a concrete runtime host target.
  - Keep these under provider/device slots rather than mixing them into process
    CPU/memory totals.

- Container and cgroup accounting.
  - Label Docker-host versus container-visible metrics clearly.
  - Decide whether process-tree totals should be host totals, container totals,
    or both.

- Lightweight history.
  - Consider a launcher-side ring buffer only if latest snapshots are not enough.
  - Otherwise let Studio build short UI history locally from latest snapshots.

- ROS/image/topic-rate enrichers.
  - Useful later for explaining runtime cost, but not required for the first
    process CPU/memory pass.

## Open Questions

- Should metrics live inline under each launcher runtime model record, or behind
  a dedicated metrics endpoint with status carrying only a summary?
