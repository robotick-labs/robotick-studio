import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode as encodePng } from "fast-png";

const { subscribeTelemetry } = vi.hoisted(() => ({
  subscribeTelemetry: vi.fn(() => vi.fn()),
}));

const projectModelsState = {
  data: [
    {
      modelShortName: "sample-robot-sensing-visual",
      modelName: "sample-robot-sensing-visual",
      data: {
        workloads: [],
      },
    },
    {
      modelShortName: "demo-robot-simulator",
      modelName: "demo-robot-simulator",
      data: {
        workloads: [
          {
            id: "image_ref_to_image_workload_3E14F044",
            name: "head_rgb_png",
          },
          {
            id: "image_ref_to_image_workload_5DB43335",
            name: "chase_camera_jpeg",
          },
        ],
      },
    },
    {
      modelShortName: "demo-robot-perception-visual",
      modelName: "demo-robot-perception-visual",
      data: {
        workloads: [
          {
            id: "object_detection_tracker_workload_52894206",
            name: "object_detection_tracker",
          },
          {
            id: "visual_field_of_view_filter_workload_406CD5A6",
            name: "visual_field_of_view_filter",
          },
          {
            id: "image_ref_to_image_workload_2B89C0A3",
            name: "head_segmented_png",
          },
        ],
      },
    },
  ],
  error: null,
  loading: false,
};

vi.mock("../../../../renderer/data-sources/telemetry", () => ({
  subscribeTelemetry,
}));

vi.mock("../../../../renderer/data-sources/launcher", () => ({
  ProjectData: {
    waitForProjectModelsLoaded: vi.fn(async () => projectModelsState),
    getProjectModelsStateSnapshot: vi.fn(() => projectModelsState),
    findModelDescriptorInState: vi.fn((_state, modelName: string) => ({
      modelName,
      telemetryBaseUrl:
        modelName === "sample-robot-sensing-visual"
          ? "http://example.test:7101"
          : modelName === "demo-robot-simulator"
            ? "http://example.test:7096"
            : `http://example.test/${modelName}`,
      data:
        projectModelsState.data.find(
          (descriptor) => descriptor.modelName === modelName,
        )?.data ?? { workloads: [] },
    })),
  },
}));

import {
  applyDepthPreviewTransformToImageData,
  applyMaskPreviewTransformToImageData,
  calculateContainedImageRect,
  createDepthPreviewImageDataFromPngBytes,
  createDepthPreviewImageDataFromSamples,
  createInstance,
  createMaskPreviewImageDataFromPngBytes,
  createMaskPreviewImageDataFromSamples,
  extractObjectDetectionOverlays,
  extractNormalizedRectOverlay,
  extractStreamingImageBytes,
  init,
  normalizedRectOverlayEquals,
  objectDetectionOverlaysEqual,
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
        "http://example.test:7096",
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

  it("resolves configured workload names to runtime workload ids without guessing by suffix", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Chase",
      streams: {
        "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
        Chase: "demo-robot-simulator.chase_camera_jpeg.outputs.image",
      },
      frameRateHz: 30,
    });

    const callback = subscribeTelemetry.mock.calls[0][2].callback;
    const getField = vi.fn((path: string) => {
      if (path === "image_ref_to_image_workload_5DB43335.outputs.image") {
        return {
          mime_type: "image/jpeg",
          getValue: () =>
            new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) as Uint8Array,
        };
      }
      return undefined;
    });

    callback({
      workloads: [
        { name: "image_ref_to_image_workload_3E14F044" },
        { name: "image_ref_to_image_workload_5DB43335" },
      ],
      getField,
    });

    expect(getField).toHaveBeenCalledWith("chase_camera_jpeg.outputs.image");
    expect(getField).toHaveBeenCalledWith(
      "image_ref_to_image_workload_5DB43335.outputs.image",
    );
    expect(getField).not.toHaveBeenCalledWith(
      "image_ref_to_image_workload_3E14F044.outputs.image",
    );
  });

  it("resolves composite layer, detections, and field-of-view paths via declared workload ids", async () => {
    await init({
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      selectedStream: "Head-RGB Detected Objects",
      streams: {
        "Head-RGB Detected Objects": {
          layers: [
            {
              source: "demo-robot-simulator.head_rgb_png.outputs.image",
              detectionsSource:
                "demo-robot-perception-visual.object_detection_tracker.outputs.tracked_detections",
              fieldOfViewSource:
                "demo-robot-perception-visual.visual_field_of_view_filter.outputs.field_of_view_rect",
            },
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

    expect(subscribeTelemetry).toHaveBeenCalledTimes(4);

    const segmentedLayerCallback = subscribeTelemetry.mock.calls[1][2].callback;
    const detectionsCallback = subscribeTelemetry.mock.calls[2][2].callback;
    const fieldOfViewCallback = subscribeTelemetry.mock.calls[3][2].callback;

    const segmentedGetField = vi.fn((path: string) => {
      if (path === "image_ref_to_image_workload_2B89C0A3.outputs.image") {
        return {
          mime_type: "image/png",
          getValue: () =>
            new Uint8Array([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            ]) as Uint8Array,
        };
      }
      return undefined;
    });
    segmentedLayerCallback({
      workloads: [{ name: "image_ref_to_image_workload_2B89C0A3" }],
      getField: segmentedGetField,
    });

    const detectionsGetField = vi.fn((path: string) => {
      if (
        path ===
        "object_detection_tracker_workload_52894206.outputs.tracked_detections"
      ) {
        return { getValue: () => ({ items: [], count: 0 }) };
      }
      return undefined;
    });
    detectionsCallback({
      workloads: [{ name: "object_detection_tracker_workload_52894206" }],
      getField: detectionsGetField,
    });

    const fieldOfViewGetField = vi.fn((path: string) => {
      if (
        path ===
        "visual_field_of_view_filter_workload_406CD5A6.outputs.field_of_view_rect"
      ) {
        return {
          getValue: () => ({
            min_x_norm: 0.1,
            min_y_norm: 0.1,
            max_x_norm: 0.9,
            max_y_norm: 0.9,
          }),
        };
      }
      return undefined;
    });
    fieldOfViewCallback({
      workloads: [{ name: "visual_field_of_view_filter_workload_406CD5A6" }],
      getField: fieldOfViewGetField,
    });

    expect(segmentedGetField).toHaveBeenCalledWith(
      "head_segmented_png.outputs.image",
    );
    expect(segmentedGetField).toHaveBeenCalledWith(
      "image_ref_to_image_workload_2B89C0A3.outputs.image",
    );
    expect(detectionsGetField).toHaveBeenCalledWith(
      "object_detection_tracker.outputs.tracked_detections",
    );
    expect(detectionsGetField).toHaveBeenCalledWith(
      "object_detection_tracker_workload_52894206.outputs.tracked_detections",
    );
    expect(fieldOfViewGetField).toHaveBeenCalledWith(
      "visual_field_of_view_filter.outputs.field_of_view_rect",
    );
    expect(fieldOfViewGetField).toHaveBeenCalledWith(
      "visual_field_of_view_filter_workload_406CD5A6.outputs.field_of_view_rect",
    );
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
    let persistedSelectedStream: string | undefined;
    const config = {
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      streams: {
        "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
        "Head-Depth": "demo-robot-simulator.head_depth_png.outputs.image",
      },
      frameRateHz: 30,
      onSelectedStreamChange: (selectedStream: string) => {
        persistedSelectedStream = selectedStream;
      },
    };

    await init({ ...config, selectedStream: persistedSelectedStream });

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

    await init({ ...config, selectedStream: persistedSelectedStream });

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

  it("persists the selected stream per panel instance", async () => {
    const persistedSelectedStreams = new Map<string, string | undefined>();
    const config = {
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
      streams: {
        "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
        "Head-Depth": "demo-robot-simulator.head_depth_png.outputs.image",
      },
      frameRateHz: 30,
    };

    await init({
      ...config,
      selectedStream: persistedSelectedStreams.get("panel-a"),
      onSelectedStreamChange: (selectedStream: string) => {
        persistedSelectedStreams.set("panel-a", selectedStream);
      },
    });

    const firstSelector = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Image stream"]'
    );
    expect(firstSelector?.value).toBe("Head-RGB");

    firstSelector!.value = "Head-Depth";
    firstSelector!.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(subscribeTelemetry).toHaveBeenCalledTimes(2);
    });

    await uninit();
    subscribeTelemetry.mockClear();

    await init({
      ...config,
      selectedStream: persistedSelectedStreams.get("panel-b"),
      onSelectedStreamChange: (selectedStream: string) => {
        persistedSelectedStreams.set("panel-b", selectedStream);
      },
    });

    const secondSelector = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Image stream"]'
    );
    expect(secondSelector?.value).toBe("Head-RGB");

    await uninit();
    subscribeTelemetry.mockClear();

    await init({
      ...config,
      selectedStream: persistedSelectedStreams.get("panel-a"),
      onSelectedStreamChange: (selectedStream: string) => {
        persistedSelectedStreams.set("panel-a", selectedStream);
      },
    });

    const restoredSelector = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Image stream"]'
    );
    expect(restoredSelector?.value).toBe("Head-Depth");
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

  it("keeps DOM, selectors, and subscriptions isolated per viewer instance", async () => {
    document.body.innerHTML =
      '<div id="viewer-a"></div><div id="viewer-b"></div>';
    const containerA = document.getElementById("viewer-a")!;
    const containerB = document.getElementById("viewer-b")!;
    const disposerA = vi.fn();
    const disposerB = vi.fn();
    subscribeTelemetry
      .mockImplementationOnce(() => disposerA)
      .mockImplementationOnce(() => disposerB);

    const instanceA = await createInstance(
      {
        camera: { fov: 60, near: 0.1, far: 100 },
        models: [],
        selectedStream: "Head-RGB",
        streams: {
          "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
          "Head-Depth": "demo-robot-simulator.head_depth_png.outputs.image",
        },
        frameRateHz: 30,
        container: containerA,
      },
      101,
    );
    const instanceB = await createInstance(
      {
        camera: { fov: 60, near: 0.1, far: 100 },
        models: [],
        selectedStream: "Chase",
        streams: {
          Chase: "demo-robot-simulator.chase_camera_jpeg.outputs.image",
          "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
        },
        frameRateHz: 30,
        container: containerB,
      },
      202,
    );

    expect(
      containerA.querySelector<HTMLSelectElement>(
        'select[aria-label="Image stream"]',
      )?.value,
    ).toBe("Head-RGB");
    expect(
      containerB.querySelector<HTMLSelectElement>(
        'select[aria-label="Image stream"]',
      )?.value,
    ).toBe("Chase");
    expect(containerA.querySelector("canvas")).not.toBeNull();
    expect(containerB.querySelector("canvas")).not.toBeNull();

    await instanceA.unmount();

    expect(disposerA).toHaveBeenCalledTimes(1);
    expect(disposerB).not.toHaveBeenCalled();
    expect(containerA.children).toHaveLength(0);
    expect(
      containerB.querySelector<HTMLSelectElement>(
        'select[aria-label="Image stream"]',
      )?.value,
    ).toBe("Chase");
    expect(containerB.querySelector("canvas")).not.toBeNull();

    await instanceB.unmount();

    expect(disposerB).toHaveBeenCalledTimes(1);
    expect(containerB.children).toHaveLength(0);
  });

  it("does not clear a shared container when a superseded instance unmounts", async () => {
    document.body.innerHTML = '<div id="viewer-shared"></div>';
    const container = document.getElementById("viewer-shared")!;
    const disposerA = vi.fn();
    const disposerB = vi.fn();
    subscribeTelemetry
      .mockImplementationOnce(() => disposerA)
      .mockImplementationOnce(() => disposerB);

    const instanceA = await createInstance(
      {
        camera: { fov: 60, near: 0.1, far: 100 },
        models: [],
        selectedStream: "Head-RGB",
        streams: {
          "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
          "Head-Depth": "demo-robot-simulator.head_depth_png.outputs.image",
        },
        frameRateHz: 30,
        container,
      },
      301,
    );
    const instanceB = await createInstance(
      {
        camera: { fov: 60, near: 0.1, far: 100 },
        models: [],
        selectedStream: "Chase",
        streams: {
          Chase: "demo-robot-simulator.chase_camera_jpeg.outputs.image",
          "Head-RGB": "demo-robot-simulator.head_rgb_png.outputs.image",
        },
        frameRateHz: 30,
        container,
      },
      302,
    );

    expect(
      container.querySelectorAll('select[aria-label="Image stream"]'),
    ).toHaveLength(2);

    await instanceA.unmount();

    const remainingSelector = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Image stream"]',
    );
    expect(disposerA).toHaveBeenCalledTimes(1);
    expect(disposerB).not.toHaveBeenCalled();
    expect(remainingSelector?.value).toBe("Chase");
    expect(container.querySelector("canvas")).not.toBeNull();

    await instanceB.unmount();

    expect(disposerB).toHaveBeenCalledTimes(1);
    expect(container.children).toHaveLength(0);
  });

  it("ignores stale telemetry callbacks after an instance unmounts", async () => {
    document.body.innerHTML = '<div id="viewer-stale"></div>';
    const container = document.getElementById("viewer-stale")!;
    const disposer = vi.fn();
    subscribeTelemetry.mockImplementationOnce(() => disposer);
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      unhandledRejections.push(event.reason);
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    const instance = await createInstance(
      {
        camera: { fov: 60, near: 0.1, far: 100 },
        models: [],
        selectedStream: "Chase",
        streams: {
          Chase: "demo-robot-simulator.chase_camera_jpeg.outputs.image",
        },
        frameRateHz: 30,
        container,
      },
      401,
    );
    const callback = subscribeTelemetry.mock.calls[0][2].callback;

    await instance.unmount();

    const getField = vi.fn();
    callback({ getField });
    await Promise.resolve();
    await Promise.resolve();

    expect(disposer).toHaveBeenCalledTimes(1);
    expect(getField).not.toHaveBeenCalled();
    expect(unhandledRejections).toHaveLength(0);

    window.removeEventListener("unhandledrejection", onUnhandledRejection);
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
  it("extracts normalized field-of-view rect telemetry", () => {
    const rect = extractNormalizedRectOverlay({
      min: { x: 0.2, y: 0.15 },
      max: { x: 0.8, y: 0.85 },
    });

    expect(rect).toEqual({
      minXNorm: 0.2,
      minYNorm: 0.15,
      maxXNorm: 0.8,
      maxYNorm: 0.85,
    });
  });

  it("extracts counted ObjectDetections telemetry vectors", () => {
    const detections = extractObjectDetectionOverlays({
      data_buffer: [
        {
          class_name: "chair",
          confidence: 0.82,
          box_norm: {
            min: { x: 0.1, y: 0.2 },
            max: { x: 0.4, y: 0.6 },
          },
          track_id: 7,
        },
        {
          class_name: "ignored",
          confidence: 0.1,
          box_norm: {
            min: { x: 0, y: 0 },
            max: { x: 1, y: 1 },
          },
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
        trackId: 7,
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
        trackId: 7,
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
    expect(label?.textContent).toBe("chair #7 82%");
    expect(label?.style.background).toContain("var(--app-panel-backdrop");
  });

  it("renders a greyed-out surround outside the visible field of view", () => {
    const overlay = document.createElement("div");

    renderObjectDetectionsOverlay(
      overlay,
      [],
      {
        minXNorm: 0.2,
        minYNorm: 0.15,
        maxXNorm: 0.8,
        maxYNorm: 0.85,
      }
    );

    const topMask = overlay.querySelector<HTMLElement>(
      '[data-role="field-of-view-mask-top"]'
    );
    const leftMask = overlay.querySelector<HTMLElement>(
      '[data-role="field-of-view-mask-left"]'
    );
    const window = overlay.querySelector<HTMLElement>(
      '[data-role="field-of-view-window"]'
    );

    expect(topMask?.style.height).toBe("15%");
    expect(leftMask?.style.width).toBe("20%");
    expect(window?.style.left).toBe("20%");
    expect(window?.style.width).toBe("60%");
  });

  it("treats tiny field-of-view jitter as unchanged", () => {
    expect(
      normalizedRectOverlayEquals(
        {
          minXNorm: 0.2,
          minYNorm: 0.15,
          maxXNorm: 0.8,
          maxYNorm: 0.85,
        },
        {
          minXNorm: 0.2004,
          minYNorm: 0.1504,
          maxXNorm: 0.8004,
          maxYNorm: 0.8504,
        }
      )
    ).toBe(true);
  });

  it("detects materially different detection overlays", () => {
    expect(
      objectDetectionOverlaysEqual(
        [
          {
            className: "chair",
            confidence: 0.82,
            boxX1Norm: 0.1,
            boxY1Norm: 0.2,
            boxX2Norm: 0.4,
            boxY2Norm: 0.6,
            trackId: 7,
          },
        ],
        [
          {
            className: "chair",
            confidence: 0.82,
            boxX1Norm: 0.6,
            boxY1Norm: 0.2,
            boxX2Norm: 0.9,
            boxY2Norm: 0.6,
            trackId: 7,
          },
        ]
      )
    ).toBe(false);
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
