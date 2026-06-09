import React from "react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const { useTelemetryStream } = vi.hoisted(() => ({
  useTelemetryStream: vi.fn(),
}));
const { useTelemetryService } = vi.hoisted(() => ({
  useTelemetryService: vi.fn(),
}));

vi.mock(
  "../../../../renderer/data-sources/telemetry",
  () => ({
    useTelemetryStream,
    useTelemetryService,
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
    vi.useRealTimers();
    useTelemetryStream.mockReset();
    useTelemetryService.mockReset();
    useTelemetryService.mockReturnValue({
      getIngressRateHz: vi.fn(() => 0),
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
          telemetryPushRateHz: 10,
          fieldConnectionHints: {},
        }}
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

    function Harness() {
      const [persistedState, setPersistedState] = React.useState({
        isExpanded: true,
      });

      return (
        <>
          <TelemetryModel
            model={{
              modelName: "Face",
              modelPath: "robots/example/face.model.yaml",
              instanceURL: "http://example.test:7100",
              telemetryPushRateHz: 10,
              fieldConnectionHints: {},
            }}
            persistedState={persistedState}
            onPersistedStateChange={(updater) =>
              setPersistedState((current) =>
                typeof updater === "function" ? updater(current) : updater
              )
            }
          />
          <div data-testid="persisted-state">{JSON.stringify(persistedState)}</div>
        </>
      );
    }

    const tree = render(
      <Harness />,
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
    expect(tree.container.querySelector("[data-testid='persisted-state']")?.textContent).toContain(
      '"workloadSortKey":"unique_name"'
    );

    const reorderedRows = Array.from(
      tree.container.querySelectorAll("[data-testid='telemetry-workload-row']"),
    );
    expect(
      reorderedRows.map((row) => row.getAttribute("data-workload-name")),
    ).toEqual(["alpha", "mike", "zeta"]);

    tree.unmount();
  });

  it("uses routed push-stats URLs and avoids overlapping poll fetches", async () => {
    vi.useFakeTimers();

    useTelemetryStream.mockReturnValue({
      model: {
        workloads: [],
        raw: null,
        schemaSessionId: "sid",
        workloads_buffer_size_used: 123,
        process_memory_used: 456,
      },
      error: null,
      revision: 0,
    });

    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const tree = render(
      <TelemetryModel
        model={{
          modelName: "Face",
          modelPath: "robots/example/face.model.yaml",
          instanceURL: "http://launcher.test/api/telemetry-gateway/models/face",
          telemetryPushRateHz: 10,
          fieldConnectionHints: {},
        }}
        persistedState={{ isExpanded: true }}
      />
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://launcher.test/api/telemetry-gateway/models/face/push_stats",
      { cache: "no-store" }
    );

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch?.(
        new Response(
          JSON.stringify({
            configured_push_rate_hz: 20,
            goal_push_rate_hz: 20,
            source_tick_rate_hz: 60,
            push_every_n_ticks: 3,
            actual_push_rate_hz: 20,
            last_push_duration_ms: 1,
            last_push_period_ms: 50,
            last_push_cost_pct_of_period: 2,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    tree.unmount();
  });
});
