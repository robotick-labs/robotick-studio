import React from "react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const { useTelemetryStream } = vi.hoisted(() => ({
  useTelemetryStream: vi.fn(),
}));

vi.mock(
  "../../../../renderer/data-sources/telemetry",
  () => ({
    useTelemetryStream,
  })
);

vi.mock(
  "../../../../renderer/components/editors/telemetry/view/TelemetryWorkload",
  () => ({
    TelemetryWorkload: () => <tr data-testid="telemetry-workload-row" />,
  })
);

import { TelemetryModel } from "../../../../renderer/components/editors/telemetry/view/TelemetryModel";

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("TelemetryModel", () => {
  beforeEach(() => {
    localStorage.clear();
    useTelemetryStream.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows layout-derived subtitle stats while collapsed and avoids rendering the telemetry table", () => {
    useTelemetryStream.mockReturnValue({
      model: {
        workloads: [],
        raw: null,
        schemaSessionId: "sid",
        workloads_buffer_size_used: 123456,
        process_memory_used: 654321,
      },
      error: null,
      revision: 0,
    });

    const tree = render(
      <TelemetryModel
        model={{
          modelName: "Face",
          modelPath: "robots/example/face.model.yaml",
          instanceURL: "http://example.test:7100",
          preferredPollRateHz: 10,
          fieldConnectionHints: {},
        }}
        index={10}
      />
    );

    expect(useTelemetryStream).toHaveBeenCalledWith(
      "http://example.test:7100",
      10,
      { active: false, ensureLayout: true }
    );
    expect(tree.container.textContent).toContain("process memory: 654,321 bytes");
    expect(tree.container.textContent).toContain(
      "workloads memory: 123,456 bytes"
    );
    expect(tree.container.querySelector("table")).toBeNull();

    tree.unmount();
  });
});
