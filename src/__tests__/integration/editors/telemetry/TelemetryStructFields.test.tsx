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
import { spawnTelemetryImagePanel } from "../../../../renderer/components/editors/telemetry/panels";
import type {
  ITelemetryField,
  ITelemetryModel,
  ITelemetryStruct,
} from "../../../../renderer/data-sources/telemetry";
import { TelemetryServiceProvider } from "../../../../renderer/data-sources/telemetry";

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
  beforeEach(() => {
    vi.mocked(spawnTelemetryImagePanel).mockClear();
  });

  afterEach(() => {
    vi.mocked(spawnTelemetryImagePanel).mockClear();
  });

  it("keeps image-like leaf rendering stable when the backing value changes", async () => {
    let currentValue: unknown = "not-image-bytes";

    const model: ITelemetryModel = {
      workloads: [],
      raw: null,
      schemaSessionId: "sid",
      workloads_buffer_size_used: 0,
      process_memory_used: 0,
    };

    const field: ITelemetryField = {
      name: "data_buffer",
      type: "DynamicStructStorageVector<uint8_t>",
      path: "outputs.image.data_buffer",
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
    expect(tree.container.textContent).toContain("Open image panel");

    currentValue = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

    await expect(
      tree.renderAsync(<TelemetryStructFields struct={struct} />)
    ).resolves.not.toThrow();
    expect(tree.container.textContent).toContain("Open image panel");

    tree.unmount();
  });

  it("renders connected writable inputs with editable controls", () => {
    const model: ITelemetryModel = {
      workloads: [],
      raw: null,
      schemaSessionId: "sid",
      workloads_buffer_size_used: 0,
      process_memory_used: 0,
    };

    const field: ITelemetryField = {
      name: "enabled",
      type: "bool",
      path: "demo.inputs.enabled",
      offset: 0,
      elementCount: 1,
      writable_input_handle: 7,
      incoming_connection_handle: 11,
      incoming_connection_enabled: true,
      model,
      getValue: () => true,
    };

    const struct: ITelemetryStruct = {
      typeName: "Inputs",
      offset: 0,
      fields: [field],
    };

    const service = {
      subscribeTelemetry: vi.fn(() => () => undefined),
      ensureLayout: vi.fn(async () => null),
      setWorkloadInputFieldsData: vi.fn(async () => ({ ok: true, status: 200, body: {} })),
      setWorkloadInputConnectionState: vi.fn(async () => ({ ok: true, status: 200, body: {} })),
      getLatestModel: vi.fn(() => model),
    };

    const tree = render(
      <TelemetryServiceProvider service={service as any}>
        <TelemetryStructFields
          struct={struct}
          telemetryBaseUrl="http://example"
          fieldConnectionHints={
            new Map([
              [
                "demo.inputs.enabled",
                {
                  localIncomingFrom: ["demo.outputs.enabled"],
                  remoteIncomingFrom: [],
                  localOutgoingTo: [],
                  remoteOutgoingTo: [],
                },
              ],
            ])
          }
        />
      </TelemetryServiceProvider>
    );

    expect(tree.container.querySelector("input[type='checkbox']")).not.toBeNull();
    expect(tree.container.textContent).toContain("enabled");

    tree.unmount();
  });

  it("opens image panels with stable model and workload ids", async () => {
    const model: ITelemetryModel = {
      workloads: [],
      raw: null,
      schemaSessionId: "sid",
      workloads_buffer_size_used: 0,
      process_memory_used: 0,
    };

    const field: ITelemetryField = {
      name: "data_buffer",
      type: "DynamicStructStorageVector<uint8_t>",
      path: "image_ref_to_image_workload_2B89C0A3.outputs.image.data_buffer",
      offset: 0,
      elementCount: 1,
      mime_type: "image/png",
      model,
      getValue: () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    };

    const struct: ITelemetryStruct = {
      typeName: "Outputs",
      offset: 0,
      fields: [field],
    };

    const tree = render(
      <TelemetryStructFields
        struct={struct}
        telemetryBaseUrl="http://example.test:7092"
        workloadId="image_ref_to_image_workload_2B89C0A3"
        workloadName="head_segmented_png"
        modelId="barr_e_perception_visual_model_C6D836F5"
        modelName="demo-robot-perception-visual"
        modelPath="robots/barr-e/models/barr-e-perception-visual.model.yaml"
        panelScope="test-floating-panels"
      />
    );

    const button = tree.container.querySelector("button");
    expect(button?.textContent).toContain("Open image panel");

    await act(async () => {
      button?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(spawnTelemetryImagePanel).toHaveBeenCalledWith({
      scope: "test-floating-panels",
      settings: {
        panelTitle: "image_ref_to_image_workload_2B89C0A3.outputs.image.data_buffer",
        telemetryBaseUrl: "http://example.test:7092",
        modelId: "barr_e_perception_visual_model_C6D836F5",
        modelName: "demo-robot-perception-visual",
        modelPath: "robots/barr-e/models/barr-e-perception-visual.model.yaml",
        workloadId: "image_ref_to_image_workload_2B89C0A3",
        workloadName: "head_segmented_png",
        fieldPath: "image_ref_to_image_workload_2B89C0A3.outputs.image.data_buffer",
      },
    });

    tree.unmount();
  });

  it("shows top-level image structs collapsed by default and expands into the shared tree view", async () => {
    const model: ITelemetryModel = {
      workloads: [],
      raw: null,
      schemaSessionId: "sid",
      workloads_buffer_size_used: 0,
      process_memory_used: 0,
    };

    const imageField: ITelemetryField = {
      name: "image",
      type: "Image",
      path: "camera.outputs.image",
      offset: 0,
      elementCount: 1,
      model,
      fields: [
        {
          name: "metadata",
          type: "ImageMetadata",
          path: "camera.outputs.image.metadata",
          offset: 0,
          elementCount: 1,
          model,
          getValue: () => ({ pixel_format: 8 }),
        },
        {
          name: "count",
          type: "uint32_t",
          path: "camera.outputs.image.count",
          offset: 0,
          elementCount: 1,
          model,
          getValue: () => 4,
        },
        {
          name: "data_buffer",
          type: "ImageByte",
          path: "camera.outputs.image.data_buffer",
          offset: 0,
          elementCount: 8,
          mime_type: "application/octet-stream",
          model,
          getValue: () => new Uint8Array([0xff, 0xd8, 0xaa, 0xd9]),
        },
      ],
      getValue: () => ({
        metadata: { pixel_format: 8 },
        count: 4,
        data_buffer: new Uint8Array([0xff, 0xd8, 0xaa, 0xd9, 0x00]),
      }),
    };
    const struct: ITelemetryStruct = {
      typeName: "Outputs",
      offset: 0,
      fields: [imageField],
    };

    const tree = render(<TelemetryStructFields struct={struct} />);
    await expect(
      tree.renderAsync(<TelemetryStructFields struct={struct} />)
    ).resolves.not.toThrow();

    expect(tree.container.textContent).toContain("image: <image 4 bytes>");
    expect(tree.container.textContent).not.toContain("metadata:");
    expect(tree.container.textContent).not.toContain("Open image panel");

    const imageToggle = tree.container.querySelector<HTMLButtonElement>("button");
    expect(imageToggle).not.toBeNull();

    await act(async () => {
      imageToggle!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    expect(tree.container.textContent).toContain("metadata:");
    expect(tree.container.textContent).toContain("count:");
    expect(tree.container.textContent).toContain("Open image panel");

    tree.unmount();
  });
});
