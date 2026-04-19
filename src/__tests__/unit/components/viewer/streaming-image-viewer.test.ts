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
  resolveStreamingImageMime,
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

  it("uses a higher telemetry sampling rate than the configured presentation rate", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      sourceModel: "alf-e-sensing-visual",
      sourceField: "camera.outputs.jpeg_data.data_buffer",
      frameRateHz: 33,
    });

    expect(subscribeTelemetry).toHaveBeenCalledWith(
      "http://example.test:7101",
      132,
      expect.objectContaining({
        callback: expect.any(Function),
        error: expect.any(Function),
      })
    );
  });

  it("uses the legacy samplingRateHz as the presentation rate when present", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      sourceModel: "alf-e-sensing-visual",
      sourceField: "camera.outputs.jpeg_data.data_buffer",
      samplingRateHz: 24,
    });

    expect(subscribeTelemetry).toHaveBeenCalledWith(
      "http://example.test:7101",
      96,
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
      120,
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

describe("viewer-streaming-image mime resolution", () => {
  it("infers PNG when dynamic parent fields have no mime_type", () => {
    const pngBytes = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
    ]);

    expect(resolveStreamingImageMime(undefined, pngBytes)).toBe("image/png");
  });

  it("keeps explicit field mime_type when present", () => {
    const pngBytes = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
    ]);

    expect(resolveStreamingImageMime("image/custom", pngBytes)).toBe(
      "image/custom"
    );
  });
});
