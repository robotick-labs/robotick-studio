# Robotick Studio Telemetry Routing Plan

This plan defines how Robotick Studio reaches a multi-device robot such as `Alf.e` for telemetry, including both read and write flows, where a desktop runs Studio, a Pi5 hosts the Linux-side models, and a CoreS3 hosts the spine.

## Goal

Provide one clean runtime entrypoint for Studio while keeping robot-to-robot traffic direct.

The intended result is:

- local-PC-first build and orchestration
- direct Pi5-to-CoreS3 engine/data traffic on the robot network
- one stable telemetry entrypoint for Studio
- consistent writable telemetry behavior through the same entrypoint
- a runtime shape that works both on a finished robot and in local development

## Core Model

Each model exposes its own telemetry server.

One model may additionally run in telemetry gateway mode.

For `Alf.e`, the initial gateway host is the Pi5-side `alf-e-rc` model.

That gives the runtime three layers:

- `Robotick Studio`
  - desktop UI
- `robotick-launcher`
  - development/build/run toolchain
- model telemetry servers
  - one of which may act as the Studio-facing telemetry gateway

Launcher remains a development tool. The finished robot runtime does not depend on a launcher-owned proxy layer.

## `Alf.e` Topology

The initial `Alf.e` split is:

- Pi5/Linux:
  - `alf-e-rc`
  - `alf-e-sensing-visual`
  - `alf-e-face`
- CoreS3/ESP32:
  - `alf-e-spine`

The Pi5 also hosts a private Wi-Fi hotspot for the CoreS3 while remaining connected to the main network for desktop access.

## Traffic Split

Use this runtime split:

- direct:
  - Pi5 ↔ CoreS3 engine/data traffic
- gatewayed:
  - desktop Studio ↔ `alf-e-rc` telemetry gateway

This means:

- Pi5-hosted models connect directly to the CoreS3 over the private robot network for remote model traffic
- Studio talks to one gateway model on the Pi5
- the gateway serves its own telemetry and proxies telemetry for the rest of the robot

## Why This Shape

`RemoteEngineConnections` already provides the right model-to-model pattern for robot-internal data traffic. That traffic should stay direct.

Telemetry is the correct layer to aggregate because:

- Studio already consumes model telemetry over HTTP
- the telemetry API surface is small and stable
- one Studio-facing entrypoint removes the need for Studio to know the full robot network shape
- a finished robot can expose the same surface without depending on launcher runtime infrastructure

## Gateway Behavior

The telemetry gateway is a capability of `TelemetryServer`, not a separate runtime daemon.

When a model runs in gateway mode, its telemetry server does two things:

- serves its own local `/api/telemetry/...`
- exposes proxied telemetry routes for discovered peer models

For `Alf.e`, the initial gateway-capable model is `alf-e-rc`.

## Discovery

Gateway discovery should reuse `RemoteEngineDiscoverer`, the same discovery mechanism family used by `RemoteEngineConnections`.

The goal is:

- one discovery mechanism family
- no parallel telemetry-only discovery stack

The discovery payload needs to cover at least:

- model name
- model IP
- telemetry port
- whether the discovered peer is itself a gateway candidate

This can be implemented as an extension of `RemoteEngineDiscoverer` and the existing REC discovery process rather than a second unrelated system.

## Routing Shape

Studio talks to one telemetry base URL: the gateway model.

The gateway then exposes:

- its own local telemetry
- a registry of discovered peer models
- one uniform per-model telemetry route shape for both local and peer models

Route shape:

- `/api/telemetry/models`
- `/api/telemetry/<model-id>/health`
- `/api/telemetry/<model-id>/workloads_buffer/layout`
- `/api/telemetry/<model-id>/workloads_buffer/raw`
- `/api/telemetry/<model-id>/set_workload_input_field_data`

Behavior:

- if `<model-id>` is the local model, serve the request directly
- if `<model-id>` is a discovered peer model, forward the request to that model's telemetry server

This keeps the client contract uniform:

- Studio does not need separate local and proxied route families
- a model can move between local and remote placement without changing the route shape
- the gateway hides the robot's internal network topology behind one stable API
- the gateway model itself should also be addressed through its own `<model-id>` route for full consistency

The gateway must preserve:

- request method
- path and query
- request body
- response status and body
- `X-Robotick-Session-Id`

Writable telemetry input requests must work through the same routed API exactly as they do directly.

## Metadata Shape

Model metadata needs to distinguish build placement from telemetry behavior.

Runtime targeting:

- `runtime.target_platform`
- `runtime.target_variant`
- `runtime.preferred_host`

Telemetry behavior:

- `telemetry.port`
- gateway mode flag or role on the selected gateway model

The simplest first shape is likely:

```yaml
telemetry:
  port: 7102
  is_gateway: true
```

The current `alf-e-rc` model is the natural first place to carry that role.

## Port Strategy

The gateway model keeps a stable, explicit telemetry port.

Non-gateway model telemetry ports may remain explicit at first.

Later, non-gateway ports may be auto-assigned, as long as they are announced through the shared discovery system and surfaced by the gateway.

The stable entrypoint for Studio is the gateway model, not the full set of inner model ports.

## Pi5 Hotspot Plan

The Pi5 provides the robot-local network:

- Pi5 stays connected to the main Wi-Fi or LAN for desktop access
- Pi5 hosts a private Wi-Fi hotspot for the CoreS3
- CoreS3 joins that hotspot as a client

This gives the Pi5 two roles:

- Linux model host
- robot-local network owner

## Launcher Role

Launcher remains responsible for development-time workflows:

- build target selection
- local build
- Pi5 deployment
- ESP32 flashing
- dry-run and profile orchestration

Launcher does not own the finished robot's runtime routing model.

Studio may still use launcher during development for project/model metadata and control, but telemetry access should be able to work against the robot runtime itself.

## Local Development Mode

The same routing model should work locally.

In local development:

- Studio runs on the desktop
- multiple models may run locally
- one model may still run in telemetry gateway mode
- Studio still talks to one entrypoint rather than needing special local-only logic

This keeps local behavior structurally close to real robot behavior.

## Implementation Plan

### Phase 1. Model metadata

- keep `target_platform`, `target_variant`, and `preferred_host`
- add gateway mode to the chosen model's `telemetry:` block

### Phase 2. Build and deployment

- keep local-PC-first build targeting
- build Pi5-compatible Linux arm64 artifacts on the desktop
- flash ESP32 over USB from the desktop

### Phase 3. Shared discovery

- extend REC discovery to advertise telemetry details
- allow the gateway model to learn peer model telemetry endpoints dynamically

### Phase 4. Gateway routes

- add peer-model registry and proxy routes to `TelemetryServer`
- keep local telemetry and proxied telemetry under one consistent API family

### Phase 5. Studio integration

- allow Studio to use one gateway telemetry base URL
- allow Studio to browse peer models through the gateway
- avoid direct per-model network assumptions in the UI

### Phase 6. Robot networking

- bring up the Pi5 private hotspot
- connect the CoreS3 to it
- keep REC traffic direct on that subnet
- keep Studio traffic routed through the gateway model

## Summary

- each model has a telemetry server
- one model may run in telemetry gateway mode
- `alf-e-rc` is the initial gateway host for `Alf.e`
- `RemoteEngineDiscoverer` should be extended and reused, not duplicated
- robot-internal engine/data traffic stays direct
- Studio talks to one runtime entrypoint instead of the full robot network
