import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../../renderer/components/editors/telemetry/panels",
  () => ({
    spawnTelemetryImagePanel: vi.fn(),
  })
);

import { TelemetryStructFields } from "../../../../renderer/components/editors/telemetry/view/TelemetryStructFields";
import type {
  ITelemetryField,
  ITelemetryModel,
  ITelemetryStruct,
} from "../../../../renderer/data-sources/telemetry";

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    render(nextNode: React.ReactElement) {
      act(() => {
        root.render(nextNode);
      });
    },
    async renderAsync(nextNode: React.ReactElement) {
      await act(async () => {
        root.render(nextNode);
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("TelemetryStructFields", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test-image"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    });
  });

  it("keeps image-field hook ordering stable when bytes become valid after expansion", async () => {
    let currentValue: unknown = "not-image-bytes";

    const model: ITelemetryModel = {
      workloads: [],
      raw: null,
      schemaSessionId: "sid",
      workloads_buffer_size_used: 0,
      process_memory_used: 0,
    };

    const field: ITelemetryField = {
      name: "jpeg_data",
      type: "DynamicStructStorageVector<uint8_t>",
      path: "outputs.jpeg_data.data_buffer",
      offset: 0,
      elementCount: 1,
      mime_type: "image/jpeg",
      model,
      getValue: () => currentValue,
    };

    const struct: ITelemetryStruct = {
      typeName: "Outputs",
      offset: 0,
      fields: [field],
    };

    const tree = render(<TelemetryStructFields struct={struct} />);

    expect(() =>
      tree.render(<TelemetryStructFields struct={struct} />)
    ).not.toThrow();
    expect(tree.container.textContent).toContain("invalid image data");

    currentValue = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

    await expect(
      tree.renderAsync(<TelemetryStructFields struct={struct} />)
    ).resolves.not.toThrow();
    expect(tree.container.querySelector("img")).not.toBeNull();

    tree.unmount();
  });
});
