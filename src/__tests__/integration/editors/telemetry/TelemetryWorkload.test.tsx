import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../../renderer/components/editors/telemetry/view/TelemetryStructFields",
  () => ({
    TelemetryStructFields: () => <div data-testid="telemetry-struct-fields" />,
  }),
);

vi.mock(
  "../../../../renderer/components/workspaces/floating-panels",
  () => ({
    useFloatingPanelsScope: () => "test-floating-scope",
  }),
);

import { TelemetryWorkload } from "../../../../renderer/components/editors/telemetry/view/TelemetryWorkload";
import type { ITelemetryWorkload } from "../../../../renderer/data-sources/telemetry";

function renderRow(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <table>
        <tbody>{node}</tbody>
      </table>,
    );
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function makeWorkload(
  overrides: Partial<ITelemetryWorkload> = {},
): ITelemetryWorkload {
  return {
    name: "jpeg",
    type: "ImageRefToImageWorkload",
    workloadsBufferTotalBytes: 278528,
    workloadsBufferStaticBytes: 16384,
    workloadsBufferDynamicBytes: 262144,
    ...overrides,
  };
}

describe("TelemetryWorkload", () => {
  it("shows total, static, and dynamic memory when dynamic storage is used", () => {
    const tree = renderRow(<TelemetryWorkload w={makeWorkload()} />);

    expect(tree.container.textContent).toContain("ImageRefToImageWorkload");
    expect(tree.container.textContent).toContain("Memory: 278,528 bytes total");
    expect(tree.container.textContent).toContain(
      "16,384 bytes static, 262,144 bytes dynamic",
    );

    tree.unmount();
  });

  it("shows only total memory when no dynamic storage is used", () => {
    const tree = renderRow(
      <TelemetryWorkload
        w={makeWorkload({
          name: "plain",
          type: "PlainWorkload",
          workloadsBufferTotalBytes: 2048,
          workloadsBufferStaticBytes: 2048,
          workloadsBufferDynamicBytes: 0,
        })}
      />,
    );

    expect(tree.container.textContent).toContain("PlainWorkload");
    expect(tree.container.textContent).toContain(
      "Memory: 2,048 bytes (all static)",
    );
    expect(tree.container.textContent).not.toContain("dynamic");

    tree.unmount();
  });
});
