import { describe, expect, it } from "vitest";

import {
  parseTerminalLogMessage,
  sortTerminalMessages,
} from "../../../../renderer/data-sources/launcher/internal/terminal-log-service";

describe("terminal log service", () => {
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
});
