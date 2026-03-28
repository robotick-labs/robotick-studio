import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { subscribeTelemetry } = vi.hoisted(() => ({
  subscribeTelemetry: vi.fn(() => vi.fn()),
}));

vi.mock("../../../../renderer/data-sources/telemetry", () => ({
  subscribeTelemetry,
}));

vi.mock("../../../../renderer/data-sources/launcher", () => ({
  ProjectData: {
    waitForProjectModelsLoaded: vi.fn(async () => ({
      data: [{ modelShortName: "alf-e-sensing-visual" }],
      error: null,
    })),
    findModelDescriptorInState: vi.fn(() => ({
      modelName: "Sensing - Visual",
      telemetryBaseUrl: "http://example.test:7101",
    })),
  },
}));

import {
  init,
  uninit,
} from "../../../../renderer/components/viewer/streaming-image/viewer-streaming-image";

describe("viewer-streaming-image polling rate config", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="viewer-container"></div>';
    subscribeTelemetry.mockClear();
  });

  afterEach(async () => {
    await uninit();
    document.body.innerHTML = "";
  });

  it("accepts legacy pollingRateHz for streaming-image viewers", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      sourceModel: "alf-e-sensing-visual",
      sourceField: "camera.outputs.jpeg_data.data_buffer",
      pollingRateHz: 33,
    });

    expect(subscribeTelemetry).toHaveBeenCalledWith(
      "http://example.test:7101",
      33,
      expect.objectContaining({
        callback: expect.any(Function),
        error: expect.any(Function),
      })
    );
  });

  it("prefers telemetryPollingRateHz when both keys are present", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      sourceModel: "alf-e-sensing-visual",
      sourceField: "camera.outputs.jpeg_data.data_buffer",
      pollingRateHz: 33,
      telemetryPollingRateHz: 12,
    });

    expect(subscribeTelemetry).toHaveBeenCalledWith(
      "http://example.test:7101",
      12,
      expect.objectContaining({
        callback: expect.any(Function),
        error: expect.any(Function),
      })
    );
  });
});
