# Streaming Image Telemetry Metrics

`viewer-streaming-image` now records frame cadence metrics so we can compare polling vs websocket behavior with hard numbers.

## Config Knobs

Use these optional viewer config keys:

- `telemetryMetricsEnabled` (default: `true`)
- `telemetryMetricsWindowMs` (default: `60000`)
- `frameStallTimeoutMs` (default: `2500`)

Example:

```ts
{
  streams: {
    Camera: "sample-robot-sensing-visual.camera.outputs.image.data_buffer",
  },
  selectedStream: "Camera",
  frameRateHz: 20,
  telemetryMetricsEnabled: true,
  telemetryMetricsWindowMs: 60000,
  frameStallTimeoutMs: 2500
}
```

## What Gets Reported

Every metrics window logs one summary to console:

- `receivedFrames`
- `presentedFrames`
- `supersededFrames`
- `transportErrors`
- `stallEvents`
- cadence stats: `averageMs`, `p50Ms`, `p95Ms`, `maxMs`

Summaries are also stored on `globalThis.__robotickTelemetryMetrics` (rolling history, latest 20 entries).
