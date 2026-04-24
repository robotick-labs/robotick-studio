import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode as encodePng } from "fast-png";

const { subscribeTelemetry } = vi.hoisted(() => ({
  subscribeTelemetry: vi.fn(() => vi.fn()),
}));

vi.mock("../../../../renderer/data-sources/telemetry", () => ({
  subscribeTelemetry,
}));

vi.mock("../../../../renderer/data-sources/launcher", () => ({
  ProjectData: {
    waitForProjectModelsLoaded: vi.fn(async () => ({
      data: [{ modelShortName: "sample-robot-sensing-visual" }],
      error: null,
    })),
    findModelDescriptorInState: vi.fn((_state, modelName: string) => ({
      modelName,
      telemetryBaseUrl:
        modelName === "sample-robot-sensing-visual"
          ? "http://example.test:7101"
          : `http://example.test/${modelName}`,
    })),
  },
}));

import {
  applyDepthPreviewTransformToImageData,
  applyMaskPreviewTransformToImageData,
  calculateContainedImageRect,
  createDepthPreviewImageDataFromPngBytes,
  createDepthPreviewImageDataFromSamples,
  createMaskPreviewImageDataFromPngBytes,
  createMaskPreviewImageDataFromSamples,
  extractObjectDetectionOverlays,
  extractStreamingImageBytes,
  init,
  renderObjectDetectionsOverlay,
  resolveStreamingImageSource,
  resolveStreamingImageStream,
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
      streams: {
        Default:
          "sample-robot-sensing-visual.camera.outputs.image.data_buffer",
      },
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
      streams: {
        Default:
          "sample-robot-sensing-visual.camera.outputs.image.data_buffer",
      },
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
      streams: {
        Default:
          "sample-robot-sensing-visual.camera.outputs.image.data_buffer",
      },
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

describe("viewer-streaming-image stream selection", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="viewer-container"></div>';
    window.localStorage.clear();
    subscribeTelemetry.mockClear();
    subscribeTelemetry.mockImplementation(() => vi.fn());
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
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("resolves selected named streams from fully-qualified field paths", () => {
    const source = resolveStreamingImageSource({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-RGB",
      streams: {
        "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
        Chase: "demo-robot-simulator.chase_camera_jpeg.outputs.image",
      },
    });

    expect(source).toMatchObject({
      id: "Head-RGB",
      sourceModel: "demo-robot-simulator",
      sourceField: "head_rgb_png.outputs.image",
    });
  });

  it("resolves object-form streams with display transforms", () => {
    const source = resolveStreamingImageSource({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-Depth",
      streams: {
        "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
        "Head-Depth": {
          source: "demo-robot-simulator.head_depth_png.outputs.image",
          transform: "depth-preview",
        },
      },
    });

    expect(source).toMatchObject({
      id: "Head-Depth",
      sourceModel: "demo-robot-simulator",
      sourceField: "head_depth_png.outputs.image",
      transform: "depth-preview",
    });
  });

  it("resolves mask preview display transforms", () => {
    const source = resolveStreamingImageSource({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-Mask",
      streams: {
        "Head-Mask": {
          source: "demo-robot-perception-visual.saved_mask.outputs.image",
          transform: "mask-preview",
        },
      },
    });

    expect(source).toMatchObject({
      id: "Head-Mask",
      sourceModel: "demo-robot-perception-visual",
      sourceField: "saved_mask.outputs.image",
      transform: "mask-preview",
    });
  });

  it("resolves object detection overlays for image streams", () => {
    const source = resolveStreamingImageSource({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-Detections",
      streams: {
        "Head-Detections": {
          source: "demo-robot-perception-visual.camera.outputs.image",
          detectionsSource:
            "demo-robot-perception-visual.detector.outputs.detections",
        },
      },
    });

    expect(source).toMatchObject({
      id: "Head-Detections",
      sourceModel: "demo-robot-perception-visual",
      sourceField: "camera.outputs.image",
      detectionsSourceField: "detector.outputs.detections",
    });
  });

  it("normalizes layered streams with blend modes and per-layer transforms", () => {
    const stream = resolveStreamingImageStream({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-Composite",
      streams: {
        "Head-Composite": {
          layers: [
            "demo-robot-simulator.head_rgb_png.outputs.image",
            {
              source: "demo-robot-perception-visual.head_segmented_png.outputs.image",
              transform: "mask-preview",
              blendMode: "screen",
              opacity: 0.65,
            },
          ],
        },
      },
    });

    expect(stream).toMatchObject({
      id: "Head-Composite",
      layers: [
        {
          index: 0,
          sourceModel: "demo-robot-simulator",
          sourceField: "head_rgb_png.outputs.image",
          transform: "none",
        },
        {
          index: 1,
          sourceModel: "demo-robot-perception-visual",
          sourceField: "head_segmented_png.outputs.image",
          transform: "mask-preview",
          blendMode: "screen",
          opacity: 0.65,
        },
      ],
    });
  });

  it("resolves cross-model object detection overlays for image streams", () => {
    const source = resolveStreamingImageSource({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-RGB Objects",
      streams: {
        "Head-RGB Objects": {
          source: "demo-robot-simulator.head_rgb_png.outputs.image",
          detectionsSource:
            "demo-robot-perception-visual.detector.outputs.detections",
        },
      },
    });

    expect(source).toMatchObject({
      id: "Head-RGB Objects",
      sourceModel: "demo-robot-simulator",
      sourceField: "head_rgb_png.outputs.image",
      detectionsSourceModel: "demo-robot-perception-visual",
      detectionsSourceField: "detector.outputs.detections",
    });
  });

  it("subscribes to cross-model object detection overlays", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-RGB Objects",
      streams: {
        "Head-RGB Objects": {
          source: "demo-robot-simulator.head_rgb_png.outputs.image",
          detectionsSource:
            "demo-robot-perception-visual.detector.outputs.detections",
        },
      },
      frameRateHz: 30,
    });

    await vi.waitFor(() => {
      expect(subscribeTelemetry).toHaveBeenCalledTimes(2);
    });

    const subscribedUrls = subscribeTelemetry.mock.calls.map((call) => call[0]);
    expect(subscribedUrls).toEqual(
      expect.arrayContaining([
        "http://example.test/demo-robot-simulator",
        "http://example.test/demo-robot-perception-visual",
      ])
    );
  });

  it("falls back to the first named stream when the selected stream is missing", () => {
    const source = resolveStreamingImageSource({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Unknown",
      streams: {
        "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
        "Head-Depth": "demo-robot-simulator.head_depth_png.outputs.image",
      },
    });

    expect(source).toMatchObject({
      id: "Head-RGB",
      sourceField: "head_rgb_png.outputs.image",
    });
  });

  it("can switch streams without reinitialising the viewer", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-RGB",
      streams: {
        "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
        "Head-Depth": "demo-robot-simulator.head_depth_png.outputs.image",
      },
      frameRateHz: 30,
    });

    const selector = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Image stream"]'
    );
    expect(selector?.value).toBe("Head-RGB");
    expect(subscribeTelemetry).toHaveBeenCalledTimes(1);

    selector!.value = "Head-Depth";
    selector!.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(subscribeTelemetry).toHaveBeenCalledTimes(2);
    });

    const callback = subscribeTelemetry.mock.calls[1][2].callback;
    const getValue = vi.fn(() => ({
      data_buffer: new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
      ]),
      count: 8,
    }));
    const getField = vi.fn(() => ({ getValue }));
    callback({ getField });

    expect(getField).toHaveBeenCalledWith("head_depth_png.outputs.image");
  });

  it("creates layered canvases and subscribes to each layer in composite streams", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-Composite",
      streams: {
        "Head-Composite": {
          layers: [
            "demo-robot-simulator.head_rgb_png.outputs.image",
            {
              source: "demo-robot-perception-visual.head_segmented_png.outputs.image",
              transform: "mask-preview",
              blendMode: "screen",
              opacity: 0.65,
            },
          ],
        },
      },
      frameRateHz: 30,
    });

    expect(subscribeTelemetry).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('canvas[data-role="streaming-image-base"], canvas[data-role="streaming-image-overlay"]')).toHaveLength(2);
    expect(
      document.querySelector('[data-role="streaming-image-layer-stack"]')
    ).not.toBeNull();
  });

  it("disposes every layer subscription when the viewer unmounts", async () => {
    const disposers: Array<ReturnType<typeof vi.fn>> = [];
    subscribeTelemetry.mockImplementation(() => {
      const dispose = vi.fn();
      disposers.push(dispose);
      return dispose;
    });

    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-Composite",
      streams: {
        "Head-Composite": {
          layers: [
            "demo-robot-simulator.head_rgb_png.outputs.image",
            "demo-robot-perception-visual.head_segmented_png.outputs.image",
          ],
        },
      },
      frameRateHz: 30,
    });

    expect(disposers).toHaveLength(2);

    await uninit();

    expect(disposers[0]).toHaveBeenCalledTimes(1);
    expect(disposers[1]).toHaveBeenCalledTimes(1);
  });

  it("persists the selected stream across viewer reinitialisation", async () => {
    const config = {
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      projectPath: "/tmp/robotick-project",
      selectedStream: "Head-RGB",
      streams: {
        "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
        "Head-Depth": "demo-robot-simulator.head_depth_png.outputs.image",
      },
      frameRateHz: 30,
    };

    await init(config);

    const selector = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Image stream"]'
    );
    expect(selector?.value).toBe("Head-RGB");

    selector!.value = "Head-Depth";
    selector!.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(subscribeTelemetry).toHaveBeenCalledTimes(2);
    });

    await uninit();
    subscribeTelemetry.mockClear();

    await init(config);

    const restoredSelector = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Image stream"]'
    );
    expect(restoredSelector?.value).toBe("Head-Depth");

    const callback = subscribeTelemetry.mock.calls[0][2].callback;
    const getValue = vi.fn(() => ({
      data_buffer: new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
      ]),
      count: 8,
    }));
    const getField = vi.fn(() => ({ getValue }));
    callback({ getField });

    expect(getField).toHaveBeenCalledWith("head_depth_png.outputs.image");
  });

  it("labels and frames the stream selector", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-RGB",
      streams: {
        "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
        "Head-Depth": "demo-robot-simulator.head_depth_png.outputs.image",
      },
      frameRateHz: 30,
    });

    const selector = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Image stream"]'
    );
    const control = selector?.closest("label");

    expect(selector).not.toBeNull();
    expect(selector?.getAttribute("aria-label")).toBe("Image stream");
    expect(control?.textContent).toContain("Image Stream");
  });
});

describe("viewer-streaming-image transforms", () => {
  it("maps raw depth samples so near non-zero pixels become bright", () => {
    const preview = createDepthPreviewImageDataFromSamples(
      4,
      1,
      1,
      new Uint16Array([0, 1000, 3000, 5000])
    );

    expect(Array.from(preview?.data ?? [])).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
      128, 128, 128, 255,
      0, 0, 0, 255,
    ]);
  });

  it("decodes 16-bit grayscale PNGs as raw depth previews", () => {
    const pngBytes = encodePng({
      width: 4,
      height: 1,
      channels: 1,
      depth: 16,
      data: new Uint16Array([0, 1000, 3000, 5000]),
    });

    const preview = createDepthPreviewImageDataFromPngBytes(
      pngBytes as Uint8Array<ArrayBuffer>
    );

    expect(Array.from(preview?.data ?? [])).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
      128, 128, 128, 255,
      0, 0, 0, 255,
    ]);
  });

  it("maps depth previews so near non-zero pixels become bright", () => {
    const imageData = {
      data: new Uint8ClampedArray([
        0, 0, 0, 255,
        10, 10, 10, 255,
        200, 200, 200, 255,
      ]),
    } as ImageData;

    applyDepthPreviewTransformToImageData(imageData);

    expect(Array.from(imageData.data)).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
    ]);
  });

  it("maps raw mask samples to visible instance colours", () => {
    const preview = createMaskPreviewImageDataFromSamples(
      4,
      1,
      1,
      new Uint8Array([0, 1, 2, 13])
    );

    expect(Array.from(preview?.data ?? [])).toEqual([
      0, 0, 0, 255,
      255, 82, 82, 255,
      77, 208, 225, 255,
      255, 82, 82, 255,
    ]);
  });

  it("decodes 8-bit grayscale PNGs as mask previews", () => {
    const pngBytes = encodePng({
      width: 4,
      height: 1,
      channels: 1,
      depth: 8,
      data: new Uint8Array([0, 1, 2, 3]),
    });

    const preview = createMaskPreviewImageDataFromPngBytes(
      pngBytes as Uint8Array<ArrayBuffer>
    );

    expect(Array.from(preview?.data ?? [])).toEqual([
      0, 0, 0, 255,
      255, 82, 82, 255,
      77, 208, 225, 255,
      255, 213, 79, 255,
    ]);
  });

  it("maps decoded grayscale mask image data to visible instance colours", () => {
    const imageData = {
      data: new Uint8ClampedArray([
        0, 0, 0, 255,
        1, 1, 1, 255,
        2, 2, 2, 255,
      ]),
    } as ImageData;

    applyMaskPreviewTransformToImageData(imageData);

    expect(Array.from(imageData.data)).toEqual([
      0, 0, 0, 255,
      255, 82, 82, 255,
      77, 208, 225, 255,
    ]);
  });
});

describe("viewer-streaming-image detection overlays", () => {
  it("extracts counted ObjectDetections telemetry vectors", () => {
    const detections = extractObjectDetectionOverlays({
      data_buffer: [
        {
          class_name: "chair",
          confidence: 0.82,
          box_x1_norm: 0.1,
          box_y1_norm: 0.2,
          box_x2_norm: 0.4,
          box_y2_norm: 0.6,
        },
        {
          class_name: "ignored",
          confidence: 0.1,
          box_x1_norm: 0,
          box_y1_norm: 0,
          box_x2_norm: 1,
          box_y2_norm: 1,
        },
      ],
      count: 1,
    });

    expect(detections).toEqual([
      {
        className: "chair",
        confidence: 0.82,
        boxX1Norm: 0.1,
        boxY1Norm: 0.2,
        boxX2Norm: 0.4,
        boxY2Norm: 0.6,
      },
    ]);
  });

  it("renders detection boxes and labels into a DOM overlay", () => {
    const overlay = document.createElement("div");

    renderObjectDetectionsOverlay(overlay, [
      {
        className: "chair",
        confidence: 0.82,
        boxX1Norm: 0.1,
        boxY1Norm: 0.2,
        boxX2Norm: 0.4,
        boxY2Norm: 0.6,
      },
    ]);

    const box = overlay.querySelector<HTMLElement>(
      '[data-role="object-detection-box"]'
    );
    const label = overlay.querySelector<HTMLElement>(
      '[data-role="object-detection-label"]'
    );

    expect(box?.style.left).toBe("10%");
    expect(box?.style.top).toBe("20%");
    expect(box?.style.width).toBe("30%");
    expect(box?.style.height).toBe("40%");
    expect(label?.textContent).toBe("chair 82%");
    expect(label?.style.background).toContain("var(--app-panel-backdrop");
  });

  it("aligns overlays to the contained image rect inside a wider canvas", () => {
    const rect = calculateContainedImageRect(
      640,
      480,
      { left: 10, top: 20, width: 800, height: 480 },
      { left: 10, top: 20 }
    );

    expect(rect).toEqual({
      left: 80,
      top: 0,
      width: 640,
      height: 480,
    });
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
