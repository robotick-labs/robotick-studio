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
  extractStreamingImageBytes,
  init,
  uninit,
} from "../../../../renderer/components/viewer/streaming-image/viewer-streaming-image";

describe("viewer-streaming-image frame rate config", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="viewer-container"></div>';
    subscribeTelemetry.mockClear();
    vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({
        fillStyle: "#000",
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        drawImage: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
  });

  afterEach(async () => {
    await uninit();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("uses frameRateHz when configured", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      sourceModel: "alf-e-sensing-visual",
      sourceField: "camera.outputs.jpeg_data.data_buffer",
      frameRateHz: 33,
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

  it("falls back to legacy samplingRateHz when present", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      sourceModel: "alf-e-sensing-visual",
      sourceField: "camera.outputs.jpeg_data.data_buffer",
      samplingRateHz: 24,
    });

    expect(subscribeTelemetry).toHaveBeenCalledWith(
      "http://example.test:7101",
      24,
      expect.objectContaining({
        callback: expect.any(Function),
        error: expect.any(Function),
      })
    );
  });

  it("defaults to 30 Hz when no frame rate is configured", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      sourceModel: "alf-e-sensing-visual",
      sourceField: "camera.outputs.jpeg_data.data_buffer",
    });

    expect(subscribeTelemetry).toHaveBeenCalledWith(
      "http://example.test:7101",
      30,
      expect.objectContaining({
        callback: expect.any(Function),
        error: expect.any(Function),
      })
    );
  });
});

describe("viewer-streaming-image byte extraction", () => {
  it("uses count to trim dynamic byte buffers", () => {
    const raw = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0]);

    const bytes = extractStreamingImageBytes({
      data_buffer: raw,
      count: 4,
      capacity: 7,
    });

    expect(Array.from(bytes ?? [])).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it("ignores empty counted dynamic byte buffers", () => {
    const bytes = extractStreamingImageBytes({
      data_buffer: new Uint8Array([0xff, 0xd8]),
      count: 0,
      capacity: 2,
    });

    expect(bytes).toBeNull();
  });
});
