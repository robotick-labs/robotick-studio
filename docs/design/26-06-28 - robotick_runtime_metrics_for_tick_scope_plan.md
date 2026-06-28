# Robotick Runtime Metrics for Tick Scope Plan

_Started 28 Jun 2026. Working implementation checklist, not a full spec._

## Aim

Tick Scope should stay focused on model/workload timing, but Studio also needs a
generic view of the runtime cost that belongs to a robot model.

First pass:

- CPU usage for the model runtime process tree
- memory usage for the model runtime process tree
- process count and top contributing processes

Later additions:

- Intel NPU usage / memory
- GPU usage / memory
- ROS/image/topic-rate enrichers
- container/cgroup-specific host accounting

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

- [ ] Add a launcher-side runtime metrics sampler.
  - Input: root pid / process group id / session id.
  - Output: one normalized metrics snapshot.
  - Linux first: read `/proc` directly.

- [ ] Track the model-owned process set.
  - Prefer process group or session id when launcher created one.
  - Fall back to descendant traversal from the root pid if needed.
  - Mark snapshots stale/unavailable when the root pid is gone.

- [ ] Compute CPU efficiently.
  - Keep previous per-pid CPU counters in launcher state.
  - Use a short remote/local sample window, probably 1s.
  - Report CPU as percent of one core, so multi-core work can exceed 100%.

- [ ] Compute memory simply.
  - Sum RSS across the selected process set.
  - Include process count and top RSS/CPU contributors.

- [ ] Expose latest metrics through launcher runtime status.
  - Add a `metrics` field to each model runtime record, or add a sibling
    `/runtime/metrics` endpoint if history/richer payloads make status too heavy.
  - Keep status cheap: latest snapshot only.

- [ ] Add CLI access.
  - Example target shape: `./tools/robotick launcher metrics --project barr-e`.
  - Support per-model filtering.
  - Make this usable without Studio.

- [ ] Wire Studio data access.
  - Extend the Electron launcher bridge contract.
  - Preserve unknown fields for forward-compatible providers.
  - Avoid polling faster than the sampler cadence.

- [ ] Show the data in Tick Scope.
  - Per model card: engine/workload timing remains primary.
  - Add runtime CPU/RSS summary from launcher metrics.
  - Show top external processes only when expanded or copied.

- [ ] Support remote runtimes.
  - The sampler must run on the machine where the model process tree is running.
  - Local launcher can request a remote JSON snapshot over the existing remote
    execution path.
  - Remote-owned CPU windows should be calculated remotely, not inferred over
    network latency.

- [ ] Add provider slots.
  - Start with `devices: []`.
  - Add Intel NPU provider later from known sysfs counters.
  - Add GPU providers only when there is a concrete runtime host target.

## Open Questions

- Should metrics live inline under each launcher runtime model record, or behind
  a dedicated metrics endpoint with status carrying only a summary?
- Do we want lightweight history/ring-buffer support in launcher, or should
  Studio do history locally from latest snapshots?
- How should Docker-host versus container-visible metrics be labelled?
