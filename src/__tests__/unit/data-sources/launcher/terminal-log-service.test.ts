import { afterEach, describe, expect, it, vi } from "vitest";

import { launcherEvents } from "../../../../renderer/data-sources/launcher/internal/LauncherContext";
import { launcherService } from "../../../../renderer/data-sources/launcher/internal/LauncherService";
import {
  parseTerminalLogMessage,
  sortTerminalMessages,
  terminalLogService,
} from "../../../../renderer/data-sources/launcher/internal/terminal-log-service";

describe("terminal log service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps launcher log events structured instead of preformatting Studio text", () => {
    const message = parseTerminalLogMessage(
      JSON.stringify({
        resource_type: "robotick_launcher_model_log_event",
        project_id: "barr-e",
        model_id: "barr-e-face",
        source_kind: "launcher-worker",
        path: "/tmp/face.log",
        offset: 12,
        line: "face ready",
        timestamp: "2026-06-12T13:54:27.140Z",
      })
    );

    expect(message).toEqual({
      kind: "launcher-event",
      target: "runtime",
      event: {
        resource_type: "robotick_launcher_model_log_event",
        project_id: "barr-e",
        model_id: "barr-e-face",
        source_kind: "launcher-worker",
        path: "/tmp/face.log",
        offset: 12,
        line: "face ready",
        timestamp: "2026-06-12T13:54:27.140Z",
      },
    });
  });

  it("keeps non-JSON terminal input as plain text", () => {
    expect(parseTerminalLogMessage("plain diagnostic line")).toEqual({
      kind: "text",
      target: "runtime",
      source: "plain-text",
      text: "plain diagnostic line",
    });
  });

  it("orders combined runtime and studio messages by timestamp", () => {
    const messages = sortTerminalMessages([
      {
        kind: "studio-event",
        target: "studio",
        event: {
          target: "studio",
          source: "renderer_console",
          window_id: "main",
          recorded_at: "2026-06-12T13:54:29.140Z",
          level: "info",
          message: "second message",
          source_url: null,
          line: null,
          column: null,
          stack: null,
          payload: null,
        },
      },
      {
        kind: "launcher-event",
        target: "runtime",
        event: {
          resource_type: "robotick_launcher_model_log_event",
          project_id: "barr-e",
          model_id: "barr-e-face",
          source_kind: "launcher-worker",
          path: "/tmp/face.log",
          offset: 12,
          line: "first message",
          timestamp: "2026-06-12T13:54:27.140Z",
        },
      },
    ]);

    expect(messages.map((message) => message.kind)).toEqual([
      "launcher-event",
      "studio-event",
    ]);
  });

  it("publishes terminal log stats for busy-stream rendering decisions", () => {
    expect(terminalLogService.getStats()).toEqual({
      totalReceived: expect.any(Number),
      bufferedCount: expect.any(Number),
      droppedCount: expect.any(Number),
      flushIntervalMs: 32,
    });
  });

  it("waits for hub log cursor clear before reconnecting on run requests", async () => {
    let resolveClear!: () => void;
    const clearRequest = new Promise<void>((resolve) => {
      resolveClear = resolve;
    });
    vi.spyOn(launcherService, "requestLauncherLogClear").mockReturnValue(clearRequest);
    vi.spyOn(launcherService, "getLauncherLogStreamUrlAsync").mockResolvedValue(
      "ws://127.0.0.1:7001/v1/launcher/models/logs/stream"
    );
    vi.spyOn(launcherService, "fetchLauncherLogSnapshot").mockResolvedValue(null);
    const sockets: string[] = [];
    class FakeWebSocket extends EventTarget {
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;

      constructor(url: string) {
        super();
        sockets.push(url);
      }

      close() {}
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const unsubscribe = terminalLogService.subscribe(() => {});

    launcherEvents.dispatchEvent(new Event("run-requested"));
    await Promise.resolve();

    expect(sockets).toEqual([]);

    resolveClear();
    await clearRequest;
    await Promise.resolve();
    await Promise.resolve();

    expect(sockets).toEqual([
      "ws://127.0.0.1:7001/v1/launcher/models/logs/stream",
    ]);
    unsubscribe();
  });

  it("does not open a terminal websocket before any subscriber is present", async () => {
    const sockets: string[] = [];
    class FakeWebSocket extends EventTarget {
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;

      constructor(url: string) {
        super();
        sockets.push(url);
      }

      close() {}
    }
    vi.spyOn(launcherService, "getLauncherLogStreamUrlAsync").mockResolvedValue(
      "ws://127.0.0.1:7001/v1/launcher/models/logs/stream"
    );
    vi.stubGlobal("WebSocket", FakeWebSocket);

    launcherEvents.dispatchEvent(new Event("run-requested"));
    await Promise.resolve();
    await Promise.resolve();

    expect(sockets).toEqual([]);
  });
});
