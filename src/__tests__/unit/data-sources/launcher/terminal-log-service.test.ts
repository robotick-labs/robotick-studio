import { describe, expect, it } from "vitest";

import {
  formatTerminalLogEvent,
  formatTerminalLogTimestamp,
} from "../../../../renderer/data-sources/launcher/internal/terminal-log-service";

describe("terminal log formatting", () => {
  it("renders readable timestamps at the far left of launcher log events", () => {
    expect(formatTerminalLogTimestamp("2026-06-12T07:53:27.735Z")).toBe(
      "2026-06-12 07:53:27"
    );

    expect(
      formatTerminalLogEvent({
        project_id: "barr-e",
        model_id: "barr-e-face",
        source_kind: "launcher-worker",
        path: "/tmp/face.log",
        offset: 12,
        line: "face ready",
        timestamp: "2026-06-12T07:53:27.735Z",
      })
    ).toBe("2026-06-12 07:53:27 [barr-e-face][launcher-worker] face ready");
  });
});
