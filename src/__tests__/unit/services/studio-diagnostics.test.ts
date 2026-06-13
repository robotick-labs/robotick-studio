import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRendererDiagnosticsSnapshot,
  publishRendererDiagnosticsPatch,
  recordRendererFetchFailure,
  recordRendererWebSocketFailure,
  registerRendererDiagnosticsProvider,
  requestRendererCommand,
  resetRendererDiagnosticsForTests,
} from "../../../renderer/services/studio-diagnostics";

describe("renderer studio diagnostics", () => {
  const snapshots: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const requestCommand = vi.fn();

  beforeEach(() => {
    snapshots.length = 0;
    events.length = 0;
    requestCommand.mockReset();
    resetRendererDiagnosticsForTests();
    (window as any).robotick = {
      diagnostics: {
        publishSnapshot: (snapshot: Record<string, unknown>) => {
          snapshots.push(snapshot);
        },
        publishEvent: (event: Record<string, unknown>) => {
          events.push(event);
        },
        requestCommand,
      },
    };
  });

  it("publishes registered provider state with sensitive fields redacted", () => {
    const unregister = registerRendererDiagnosticsProvider("launcher", () => ({
      current_project_path: "/tmp/barr-e.project.yaml",
      token: "secret-token",
      nested: {
        Authorization: "Bearer abc123",
        url: "http://127.0.0.1:7000/status?token=abc123",
      },
    }));

    expect(snapshots.at(-1)).toMatchObject({
      diagnostics_providers: {
        launcher: {
          current_project_path: "/tmp/barr-e.project.yaml",
          token: "[redacted]",
          nested: {
            Authorization: "[redacted]",
            url: "http://127.0.0.1:7000/status?token=[redacted]",
          },
        },
      },
    });

    unregister();
    expect(getRendererDiagnosticsSnapshot()).not.toHaveProperty(
      "diagnostics_providers.launcher"
    );
  });

  it("publishes patches with redaction applied", () => {
    publishRendererDiagnosticsPatch({
      launcher: {
        cached_hub_endpoint: "http://127.0.0.1:7000/?api_key=abc",
        auth_header: "Bearer abc",
      },
    });

    expect(snapshots.at(-1)).toMatchObject({
      launcher: {
        cached_hub_endpoint: "http://127.0.0.1:7000/?api_key=[redacted]",
        auth_header: "[redacted]",
      },
    });
  });

  it("records fetch and websocket failures into snapshots and target-log events", () => {
    recordRendererFetchFailure({
      source: "launcher-interface",
      operation: "GET /v1/launcher/runtime",
      url: "http://127.0.0.1:7000/runtime?token=abc",
      statusCode: 500,
      message: "Request failed with token=abc",
    });
    recordRendererWebSocketFailure({
      source: "terminal-log-service",
      phase: "close",
      url: "ws://127.0.0.1:7000/logs?access_token=abc",
      closeCode: 1006,
      message: "websocket closed",
    });

    expect(snapshots.at(-1)).toMatchObject({
      fetch_failures: [
        expect.objectContaining({
          source: "launcher-interface",
          url: "http://127.0.0.1:7000/runtime?token=[redacted]",
        }),
      ],
      websocket_failures: [
        expect.objectContaining({
          source: "terminal-log-service",
          url: "ws://127.0.0.1:7000/logs?access_token=[redacted]",
        }),
      ],
    });
    expect(events).toEqual([
      expect.objectContaining({
        source: "renderer_fetch",
        level: "error",
      }),
      expect.objectContaining({
        source: "renderer_websocket",
        level: "error",
      }),
    ]);
  });

  it("routes renderer-assisted command requests through the preload bridge", async () => {
    requestCommand.mockResolvedValue({
      accepted: true,
      command_id: "studio.renderer.location",
      url: "http://localhost:5173/remote-control",
    });

    await expect(
      requestRendererCommand("studio.renderer.location", { window_id: "main" })
    ).resolves.toEqual({
      accepted: true,
      command_id: "studio.renderer.location",
      url: "http://localhost:5173/remote-control",
    });
    expect(requestCommand).toHaveBeenCalledWith("studio.renderer.location", {
      window_id: "main",
    });
  });
});
