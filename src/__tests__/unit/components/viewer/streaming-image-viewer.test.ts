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
  applyDepthPreviewTransformToImageData,
  applyMaskPreviewTransformToImageData,
  createDepthPreviewImageDataFromPngBytes,
  createDepthPreviewImageDataFromSamples,
  createMaskPreviewImageDataFromPngBytes,
  createMaskPreviewImageDataFromSamples,
  drawObjectDetectionsOverlay,
  extractObjectDetectionOverlays,
  extractStreamingImageBytes,
  init,
  resolveStreamingImageSource,
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
      sourceField: "camera.outputs.image.data_buffer",
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
      sourceField: "camera.outputs.image.data_buffer",
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
      sourceField: "camera.outputs.image.data_buffer",
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
        "Head-RGB": "barr-e-simulator.head_rgb_png.outputs.image",
        Chase: "barr-e-simulator.chase_camera_jpeg.outputs.image",
      },
    });

    expect(source).toMatchObject({
      id: "Head-RGB",
      sourceModel: "barr-e-simulator",
      sourceField: "head_rgb_png.outputs.image",
    });
  });

  it("resolves object-form streams with display transforms", () => {
    const source = resolveStreamingImageSource({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-Depth",
      streams: {
        "Head-RGB": "barr-e-simulator.head_rgb_png.outputs.image",
        "Head-Depth": {
          source: "barr-e-simulator.head_depth_png.outputs.image",
          transform: "depth-preview",
        },
      },
    });

    expect(source).toMatchObject({
      id: "Head-Depth",
      sourceModel: "barr-e-simulator",
      sourceField: "head_depth_png.outputs.image",
      transform: "depth-preview",
    });
  });

  it("resolves mask preview display transforms", () => {
    const source = resolveStreamingImageSource({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-YOLO-Mask",
      streams: {
        "Head-YOLO-Mask": {
          source: "barr-e-perception-visual.saved_mask_png.outputs.image",
          transform: "mask-preview",
        },
      },
    });

    expect(source).toMatchObject({
      id: "Head-YOLO-Mask",
      sourceModel: "barr-e-perception-visual",
      sourceField: "saved_mask_png.outputs.image",
      transform: "mask-preview",
    });
  });

  it("resolves object detection overlays for image streams", () => {
    const source = resolveStreamingImageSource({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-YOLO-Bounds",
      streams: {
        "Head-YOLO-Bounds": {
          source:
            "barr-e-perception-visual.visual_perception_interface.outputs.head_rgb_image",
          detectionsSource:
            "barr-e-perception-visual.head_yolo.outputs.script.detections",
        },
      },
    });

    expect(source).toMatchObject({
      id: "Head-YOLO-Bounds",
      sourceModel: "barr-e-perception-visual",
      sourceField: "visual_perception_interface.outputs.head_rgb_image",
      detectionsSourceField: "head_yolo.outputs.script.detections",
    });
  });

  it("falls back to the first named stream when the selected stream is missing", () => {
    const source = resolveStreamingImageSource({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Unknown",
      streams: {
        "Head-RGB": "barr-e-simulator.head_rgb_png.outputs.image",
        "Head-Depth": "barr-e-simulator.head_depth_png.outputs.image",
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
        "Head-RGB": "barr-e-simulator.head_rgb_png.outputs.image",
        "Head-Depth": "barr-e-simulator.head_depth_png.outputs.image",
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

  it("persists the selected stream across viewer reinitialisation", async () => {
    const config = {
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      projectPath: "/tmp/robotick-project",
      selectedStream: "Head-RGB",
      streams: {
        "Head-RGB": "barr-e-simulator.head_rgb_png.outputs.image",
        "Head-Depth": "barr-e-simulator.head_depth_png.outputs.image",
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
        "Head-RGB": "barr-e-simulator.head_rgb_png.outputs.image",
        "Head-Depth": "barr-e-simulator.head_depth_png.outputs.image",
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

  it("draws detection boxes and labels onto a canvas context", () => {
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 64 })),
      set lineWidth(value: number) {
        void value;
      },
      set font(value: string) {
        void value;
      },
      set textBaseline(value: CanvasTextBaseline) {
        void value;
      },
      set strokeStyle(value: string) {
        void value;
      },
      set fillStyle(value: string) {
        void value;
      },
    } as unknown as CanvasRenderingContext2D;

    drawObjectDetectionsOverlay(context, 640, 420, [
      {
        className: "chair",
        confidence: 0.82,
        boxX1Norm: 0.1,
        boxY1Norm: 0.2,
        boxX2Norm: 0.4,
        boxY2Norm: 0.6,
      },
    ]);

    expect(context.strokeRect).toHaveBeenCalledWith(64, 84, 192, 168);
    expect(context.fillText).toHaveBeenCalledWith("chair 82%", 68, 70);
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
