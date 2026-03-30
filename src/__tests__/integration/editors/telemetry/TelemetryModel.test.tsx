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
    TelemetryWorkload: ({ w }: { w: { name: string; type: string } }) => (
      <tr data-testid="telemetry-workload-row" data-workload-name={w.name}>
        <td>{w.name}</td>
        <td>{w.type}</td>
      </tr>
    ),
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

  it("defaults to model order and can opt into layout-driven sorting", () => {
    localStorage.setItem("telemetry-expanded-http___example_test_7100", "true");

    useTelemetryStream.mockReturnValue({
      model: {
        workloads: [
          {
            name: "zeta",
            type: "BravoType",
            workloadsBufferTotalBytes: 400,
            workloadsBufferStaticBytes: 350,
            workloadsBufferDynamicBytes: 50,
          },
          {
            name: "alpha",
            type: "ZuluType",
            workloadsBufferTotalBytes: 300,
            workloadsBufferStaticBytes: 300,
            workloadsBufferDynamicBytes: 0,
          },
          {
            name: "mike",
            type: "AlphaType",
            workloadsBufferTotalBytes: 200,
            workloadsBufferStaticBytes: 150,
            workloadsBufferDynamicBytes: 50,
          },
        ],
        raw: null,
        schemaSessionId: "sid",
        workloads_buffer_size_used: 600,
        process_memory_used: 900,
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
      />,
    );

    const rows = Array.from(
      tree.container.querySelectorAll("[data-testid='telemetry-workload-row']"),
    );
    expect(rows.map((row) => row.getAttribute("data-workload-name"))).toEqual([
      "zeta",
      "alpha",
      "mike",
    ]);

    const sortSelect = tree.container.querySelector(
      "#workload-sort-http___example_test_7100",
    ) as HTMLSelectElement | null;
    expect(sortSelect).not.toBeNull();
    expect(sortSelect?.value).toBe("none");
    expect(Array.from(sortSelect?.options ?? []).map((option) => option.text)).toEqual([
      "-",
      "Unique Name",
      "Workload Type",
      "Memory - Total",
      "Memory - Static",
      "Memory - Dynamic",
    ]);

    act(() => {
      if (sortSelect) {
        sortSelect.value = "unique_name";
        sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const reorderedRows = Array.from(
      tree.container.querySelectorAll("[data-testid='telemetry-workload-row']"),
    );
    expect(
      reorderedRows.map((row) => row.getAttribute("data-workload-name")),
    ).toEqual(["alpha", "mike", "zeta"]);

    tree.unmount();
  });
});
