import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTelemetryModel,
  type LayoutModel,
  setWorkloadInputConnectionState,
  setWorkloadInputFieldsData,
} from "../../../../../renderer/data-sources/telemetry/internal/telemetry-client";

function installTelemetryBridge(overrides: Partial<NonNullable<Window["robotick"]>["telemetry"]>) {
  const telemetry = {
    ensureLayout: vi.fn(),
    refreshLayout: vi.fn(),
    getDiagnostics: vi.fn(),
    getSharedDiagnostics: vi.fn(async () => ({
      activeBaseUrlCount: 0,
      totalSubscriberCount: 0,
      baseUrls: [],
    })),
    getHealth: vi.fn(),
    getPushStats: vi.fn(),
    setWorkloadInputFieldsData: vi.fn(),
    setWorkloadInputConnectionState: vi.fn(),
    subscribe: vi.fn(),
    ...overrides,
  };
  (window as unknown as { robotick?: unknown }).robotick = { telemetry };
  return telemetry;
}

describe("setWorkloadInputFieldsData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { robotick?: unknown }).robotick;
    vi.clearAllMocks();
  });

  it("retries on retryable status and eventually succeeds", async () => {
    const telemetry = installTelemetryBridge({});
    telemetry.setWorkloadInputFieldsData
      .mockResolvedValueOnce(
        {
          ok: false,
          status: 429,
          body: { error: "throttled", retry_after_ms: 1 },
        },
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: { status: "accepted" },
      });

    const requestPromise = setWorkloadInputFieldsData(
      "http://example",
      {
        engine_session_id: "sid",
        writes: [{ field_handle: 1, value: true }],
      },
      {
        maxAttempts: 3,
        baseRetryDelayMs: 1,
        maxRetryDelayMs: 2,
      },
    );

    await vi.runAllTimersAsync();
    const result = await requestPromise;

    expect(telemetry.setWorkloadInputFieldsData).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("does not retry non-retryable status codes", async () => {
    const telemetry = installTelemetryBridge({});
    telemetry.setWorkloadInputFieldsData.mockResolvedValue({
      ok: false,
      status: 400,
      body: { error: "bad_request" },
    });

    const result = await setWorkloadInputFieldsData("http://example", {
      engine_session_id: "sid",
      writes: [{ field_handle: 7, value: 123 }],
    });

    expect(telemetry.setWorkloadInputFieldsData).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("retries once with the corrected engine session id on session mismatch", async () => {
    const telemetry = installTelemetryBridge({});
    telemetry.setWorkloadInputFieldsData
      .mockResolvedValueOnce({
        ok: false,
        status: 412,
        body: {
          error: "session_mismatch",
          engine_session_id: "sid-corrected",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: { status: "processed", accepted_count: 1 },
      });

    const result = await setWorkloadInputFieldsData("http://example", {
      engine_session_id: "sid-stale",
      writes: [{ field_handle: 7, value: 0.5 }],
    });

    expect(telemetry.setWorkloadInputFieldsData).toHaveBeenCalledTimes(2);
    expect(telemetry.setWorkloadInputFieldsData.mock.calls[1]?.[1]?.engine_session_id).toBe(
      "sid-corrected",
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

});

describe("setWorkloadInputConnectionState", () => {
  afterEach(() => {
    delete (window as unknown as { robotick?: unknown }).robotick;
    vi.clearAllMocks();
  });

  it("sends connection suppression updates through the Electron telemetry bridge", async () => {
    const telemetry = installTelemetryBridge({});
    telemetry.setWorkloadInputConnectionState.mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        status: "processed",
        updates: [
          {
            field_handle: 7,
            incoming_connection_enabled: false,
          },
        ],
      },
    });

    const result = await setWorkloadInputConnectionState("http://example", {
      engine_session_id: "sid",
      updates: [{ field_handle: 7, enabled: false }],
    });

    expect(telemetry.setWorkloadInputConnectionState).toHaveBeenCalledWith(
      "http://example",
      {
        engine_session_id: "sid",
        updates: [{ field_handle: 7, enabled: false }],
      },
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("retries connection suppression with the corrected engine session id", async () => {
    const telemetry = installTelemetryBridge({});
    telemetry.setWorkloadInputConnectionState
      .mockResolvedValueOnce(
        {
          ok: false,
          status: 412,
          body: {
          error: "session_mismatch",
          engine_session_id: "sid-corrected",
          },
        },
      )
      .mockResolvedValueOnce(
        {
          ok: true,
          status: 200,
          body: { status: "processed" },
        },
      );

    const result = await setWorkloadInputConnectionState("http://example", {
      engine_session_id: "sid-stale",
      updates: [{ field_handle: 7, enabled: false }],
    });

    expect(telemetry.setWorkloadInputConnectionState).toHaveBeenCalledTimes(2);
    expect(
      telemetry.setWorkloadInputConnectionState.mock.calls[1]?.[1]
        ?.engine_session_id,
    ).toBe("sid-corrected");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("retries connection suppression on retryable REST failures", async () => {
    vi.useFakeTimers();
    try {
      const telemetry = installTelemetryBridge({});
      telemetry.setWorkloadInputConnectionState
        .mockResolvedValueOnce(
          {
            ok: false,
            status: 503,
            body: { error: "busy", retry_after_ms: 1 },
          },
        )
        .mockResolvedValueOnce(
          {
            ok: true,
            status: 200,
            body: { status: "processed" },
          },
        );

      const requestPromise = setWorkloadInputConnectionState(
        "http://example",
        {
          engine_session_id: "sid",
          updates: [{ field_handle: 7, enabled: false }],
        },
        {
          maxAttempts: 2,
          baseRetryDelayMs: 1,
          maxRetryDelayMs: 2,
        },
      );

      await vi.runAllTimersAsync();
      const result = await requestPromise;

      expect(telemetry.setWorkloadInputConnectionState).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createTelemetryModel", () => {
  it("ignores legacy layout process thread samples", () => {
    const layout = {
      engine_session_id: "sid",
      workloads_buffer_size_used: 0,
      process_threads: [
        {
          thread_id: 13,
          name: "runtime-worker",
          display_name: "Runtime worker",
          role: "runtime",
          cpu_time_ns: 50000000,
          cpu_time_delta_ns: 2000000,
          cpu_sample_window_ns: 50000000,
          logical_cpu_id: 3,
        },
      ],
      workloads: [],
      types: [],
    } as unknown as LayoutModel;

    const model = createTelemetryModel(layout);

    expect(model.process_threads).toEqual([]);
  });

  it("decodes process thread CPU samples from the current engine raw buffer", () => {
    const threadSize = 104;
    const processIdOffset = 0;
    const processMemoryOffset = 8;
    const processThreadsOffset = 16;
    const vectorCountOffset = threadSize * 64;
    const rawCountOffset = processThreadsOffset + vectorCountOffset;
    const layout: LayoutModel = {
      engine_session_id: "sid",
      workloads_buffer_size_used: rawCountOffset + 4,
      engine: {
        type: "EngineInfo",
        offset_within_container: 0,
      },
      workloads: [],
      types: [
        { name: "uint32_t", size: 4 },
        { name: "uint64_t", size: 8 },
        { name: "int32_t", size: 4 },
        { name: "FixedString64", size: 64, mime_type: "text/plain" },
        {
          name: "EngineProcessThreadStats",
          size: threadSize,
          fields: [
            { name: "thread_id", type: "uint64_t", offset_within_container: 0, element_count: 1 },
            { name: "name", type: "FixedString64", offset_within_container: 8, element_count: 1 },
            { name: "cpu_time_ns", type: "uint64_t", offset_within_container: 72, element_count: 1 },
            { name: "cpu_time_delta_ns", type: "uint64_t", offset_within_container: 80, element_count: 1 },
            { name: "cpu_sample_window_ns", type: "uint64_t", offset_within_container: 88, element_count: 1 },
            { name: "logical_cpu_id", type: "int32_t", offset_within_container: 96, element_count: 1 },
          ],
        },
        {
          name: "EngineProcessThreadStatsVector",
          size: vectorCountOffset + 4,
          fields: [
            {
              name: "data_buffer",
              type: "EngineProcessThreadStats",
              offset_within_container: 0,
              element_count: 64,
            },
            { name: "count", type: "uint32_t", offset_within_container: vectorCountOffset, element_count: 1 },
          ],
        },
        {
          name: "EngineInfo",
          size: rawCountOffset + 4,
          fields: [
            {
              name: "process_id",
              type: "uint64_t",
              offset_within_container: processIdOffset,
              element_count: 1,
            },
            {
              name: "process_memory_used",
              type: "uint64_t",
              offset_within_container: processMemoryOffset,
              element_count: 1,
            },
            {
              name: "process_threads",
              type: "EngineProcessThreadStatsVector",
              offset_within_container: processThreadsOffset,
              element_count: 1,
            },
          ],
        },
      ],
    };

    const writeSample = (deltaNs: bigint, processMemoryUsed: bigint) => {
      const raw = new ArrayBuffer(rawCountOffset + 4);
      const view = new DataView(raw);
      view.setBigUint64(processIdOffset, 12345n, true);
      view.setBigUint64(processMemoryOffset, processMemoryUsed, true);
      view.setBigUint64(processThreadsOffset, 42n, true);
      new Uint8Array(raw, processThreadsOffset + 8, 64).set(new TextEncoder().encode("rtk-tel-ws-bcst"));
      view.setBigUint64(processThreadsOffset + 72, 100000000n + deltaNs, true);
      view.setBigUint64(processThreadsOffset + 80, deltaNs, true);
      view.setBigUint64(processThreadsOffset + 88, 50000000n, true);
      view.setInt32(processThreadsOffset + 96, 7, true);
      view.setUint32(rawCountOffset, 1, true);
      return raw;
    };

    const model = createTelemetryModel(layout);
    model.raw = writeSample(1000000n, 64000000n);
    expect(model.process_id).toBe(12345);
    expect(model.process_memory_used).toBe(64000000);
    expect(model.process_threads).toEqual([
      {
        threadId: 42,
        name: "rtk-tel-ws-bcst",
        displayName: "Telemetry websocket broadcast",
        role: "telemetry",
        cpuTimeNs: 101000000,
        cpuTimeDeltaNs: 1000000,
        cpuSampleWindowNs: 50000000,
        logicalCpuId: 7,
      },
    ]);

    model.raw = writeSample(3000000n, 65000000n);
    expect(model.process_memory_used).toBe(65000000);
    expect(model.process_threads[0]?.cpuTimeDeltaNs).toBe(3000000);
  });

  it("decodes int32_t primitive fields", () => {
    const layout: LayoutModel = {
      engine_session_id: "sid",
      workloads_buffer_size_used: 128,
      workloads: [
        {
          name: "detector",
          type: "DetectorWorkload",
          offset_within_container: 16,
          stats_offset_within_container: 96,
          outputs: {
            type: "DetectorOutputs",
            offset_within_container: 0,
          },
        },
      ],
      types: [
        { name: "int32_t", size: 4 },
        { name: "WorkloadInstanceStats", size: 32 },
        {
          name: "DetectorOutputs",
          size: 4,
          fields: [
            {
              name: "class_id",
              type: "int32_t",
              offset_within_container: 0,
              element_count: 1,
            },
          ],
        },
      ],
    };
    const raw = new ArrayBuffer(128);
    new DataView(raw).setInt32(16, -7, true);

    const model = createTelemetryModel(layout);
    model.raw = raw;

    expect(model.getField?.("detector.outputs.class_id")?.getValue()).toBe(-7);
  });

  it("decodes 64-bit workload span stats", () => {
    const layout: LayoutModel = {
      engine_session_id: "sid",
      workloads_buffer_size_used: 320,
      workloads: [
        {
          name: "sequenced",
          type: "SequencedGroupWorkload",
          offset_within_container: 16,
          stats_offset_within_container: 96,
        },
      ],
      types: [
        { name: "bool", size: 1 },
        { name: "int32_t", size: 4 },
        { name: "uint64_t", size: 8 },
        {
          name: "WorkloadLatestSpanStats",
          size: 72,
          fields: [
            {
              name: "tick_seq",
              type: "uint64_t",
              offset_within_container: 0,
              element_count: 1,
            },
            {
              name: "kernel_thread_id",
              type: "uint64_t",
              offset_within_container: 16,
              element_count: 1,
            },
            {
              name: "logical_cpu_start_id",
              type: "int32_t",
              offset_within_container: 24,
              element_count: 1,
            },
            {
              name: "scheduled_start_time_ns",
              type: "uint64_t",
              offset_within_container: 32,
              element_count: 1,
            },
            {
              name: "is_running",
              type: "bool",
              offset_within_container: 64,
              element_count: 1,
            },
          ],
        },
        {
          name: "WorkloadInstanceStats",
          size: 168,
          fields: [
            {
              name: "latest_span",
              type: "WorkloadLatestSpanStats",
              offset_within_container: 96,
              element_count: 1,
            },
          ],
        },
      ],
    };
    const raw = new ArrayBuffer(320);
    const view = new DataView(raw);
    const latestSpanOffset = 96 + 96;
    view.setBigUint64(latestSpanOffset, 1234n, true);
    view.setBigUint64(latestSpanOffset + 16, 42n, true);
    view.setInt32(latestSpanOffset + 24, 7, true);
    view.setBigUint64(latestSpanOffset + 32, 1_000_000_000n, true);
    view.setUint8(latestSpanOffset + 64, 1);

    const model = createTelemetryModel(layout);
    model.raw = raw;
    const latestSpan = model.workloads[0]?.stats?.fields.find(
      (field) => field.name === "latest_span",
    );

    expect(
      latestSpan?.fields?.find((field) => field.name === "tick_seq")?.getValue(),
    ).toBe(1234);
    expect(
      latestSpan?.fields
        ?.find((field) => field.name === "kernel_thread_id")
        ?.getValue(),
    ).toBe(42);
    expect(
      latestSpan?.fields
        ?.find((field) => field.name === "logical_cpu_start_id")
        ?.getValue(),
    ).toBe(7);
    expect(
      latestSpan?.fields
        ?.find((field) => field.name === "scheduled_start_time_ns")
        ?.getValue(),
    ).toBe(1_000_000_000);
    expect(
      latestSpan?.fields
        ?.find((field) => field.name === "is_running")
        ?.getValue(),
    ).toBe(true);
  });

  it("computes per-workload static and dynamic workloads-buffer memory", () => {
    const layout: LayoutModel = {
      engine_session_id: "sid",
      workloads_buffer_size_used: 0,
      workloads: [
        {
          name: "jpeg",
          type: "ImageRefToImageWorkload",
          offset_within_container: 100,
          stats_offset_within_container: 1000,
          config: {
            type: "ImageRefToImageConfig",
            offset_within_container: 16,
          },
          outputs: {
            type: "ImageRefToImageOutputs",
            offset_within_container: 24,
          },
        },
        {
          name: "plain",
          type: "PlainWorkload",
          offset_within_container: 500,
          stats_offset_within_container: 1200,
          config: {
            type: "PlainConfig",
            offset_within_container: 8,
          },
          outputs: {
            type: "PlainOutputs",
            offset_within_container: 16,
          },
        },
      ],
      types: [
        { name: "uint8_t", size: 1 },
        { name: "uint32_t", size: 4 },
        { name: "WorkloadInstanceStats", size: 32 },
        {
          name: "ImageRefToImageConfig",
          size: 8,
          fields: [
            {
              name: "image",
              type: "DynamicStructStorageVector_uint8_t_256",
              offset_within_container: 0,
              element_count: 1,
            },
          ],
        },
        {
          name: "ImageRefToImageOutputs",
          size: 12,
          fields: [
            {
              name: "jpeg_size",
              type: "uint32_t",
              offset_within_container: 0,
              element_count: 1,
            },
          ],
        },
        { name: "PlainConfig", size: 4, fields: [] },
        {
          name: "PlainOutputs",
          size: 12,
          fields: [
            {
              name: "counter",
              type: "uint32_t",
              offset_within_container: 0,
              element_count: 1,
            },
          ],
        },
        {
          name: "DynamicStructStorageVector_uint8_t_256",
          size: 8,
          fields: [
            {
              name: "data_buffer",
              type: "uint8_t",
              offset_within_container: 128,
              element_count: 256,
            },
            {
              name: "count",
              type: "uint32_t",
              offset_within_container: 0,
              element_count: 1,
            },
            {
              name: "capacity",
              type: "uint32_t",
              offset_within_container: 4,
              element_count: 1,
            },
          ],
        },
      ],
    };

    const model = createTelemetryModel(layout);
    const jpeg = model.workloads.find((workload) => workload.name === "jpeg");
    const plain = model.workloads.find((workload) => workload.name === "plain");

    expect(jpeg).toMatchObject({
      workloadsBufferStaticBytes: 52,
      workloadsBufferDynamicBytes: 256,
      workloadsBufferTotalBytes: 308,
    });
    expect(plain).toMatchObject({
      workloadsBufferStaticBytes: 48,
      workloadsBufferDynamicBytes: 0,
      workloadsBufferTotalBytes: 48,
    });
  });

  it("does not count inline fixed-vector fields as dynamic memory", () => {
    const layout: LayoutModel = {
      engine_session_id: "sid",
      workloads_buffer_size_used: 0,
      workloads: [
        {
          name: "mic",
          type: "MicWorkload",
          offset_within_container: 560,
          stats_offset_within_container: 0,
          inputs: {
            type: "MicInputs",
            offset_within_container: 4,
          },
          outputs: {
            type: "MicOutputs",
            offset_within_container: 8,
          },
        },
      ],
      types: [
        { name: "float", size: 4 },
        { name: "bool", size: 1 },
        { name: "uint32_t", size: 4 },
        { name: "double", size: 8 },
        { name: "AudioQueueResult", size: 4 },
        { name: "WorkloadInstanceStats", size: 552 },
        {
          name: "MicInputs",
          size: 4,
          fields: [
            {
              name: "amplitude_gain_db",
              type: "float",
              offset_within_container: 0,
              element_count: 1,
            },
          ],
        },
        {
          name: "MicOutputs",
          size: 2088,
          fields: [
            {
              name: "mono",
              type: "AudioFrame",
              offset_within_container: 0,
              element_count: 1,
            },
            {
              name: "success",
              type: "bool",
              offset_within_container: 2072,
              element_count: 1,
            },
            {
              name: "last_read_status",
              type: "AudioQueueResult",
              offset_within_container: 2076,
              element_count: 1,
            },
            {
              name: "dropped_reads",
              type: "uint32_t",
              offset_within_container: 2080,
              element_count: 1,
            },
          ],
        },
        {
          name: "AudioFrame",
          size: 2072,
          fields: [
            {
              name: "samples",
              type: "AudioBuffer512",
              offset_within_container: 0,
              element_count: 1,
            },
            {
              name: "timestamp",
              type: "double",
              offset_within_container: 2056,
              element_count: 1,
            },
            {
              name: "sample_rate",
              type: "uint32_t",
              offset_within_container: 2064,
              element_count: 1,
            },
          ],
        },
        {
          name: "AudioBuffer512",
          size: 2052,
          fields: [
            {
              name: "data_buffer",
              type: "float",
              offset_within_container: 0,
              element_count: 512,
            },
            {
              name: "count",
              type: "uint32_t",
              offset_within_container: 2048,
              element_count: 1,
            },
          ],
        },
      ],
    };

    const model = createTelemetryModel(layout);
    expect(model.workloads[0]).toMatchObject({
      workloadsBufferStaticBytes: 2644,
      workloadsBufferDynamicBytes: 0,
      workloadsBufferTotalBytes: 2644,
    });
  });

  it("reads repeated dynamic struct fields through their instance-specific layout types", () => {
    const layout: LayoutModel = {
      engine_session_id: "sid",
      workloads_buffer_size_used: 4096,
      workloads: [
        {
          name: "first",
          type: "ImageRefToImageWorkload",
          offset_within_container: 100,
          stats_offset_within_container: 3000,
          outputs: {
            type: "ImageRefToImageOutputs_A",
            offset_within_container: 0,
          },
        },
        {
          name: "second",
          type: "ImageRefToImageWorkload",
          offset_within_container: 200,
          stats_offset_within_container: 3100,
          outputs: {
            type: "ImageRefToImageOutputs_B",
            offset_within_container: 0,
          },
        },
      ],
      types: [
        { name: "uint8_t", size: 1 },
        { name: "uint32_t", size: 4 },
        { name: "WorkloadInstanceStats", size: 32 },
        {
          name: "ImageByte",
          size: 1,
          mime_type: "image/jpeg",
        },
        {
          name: "ImageRefToImageOutputs_A",
          size: 8,
          fields: [
            {
              name: "image",
              type: "Image_A",
              offset_within_container: 0,
              element_count: 1,
            },
          ],
        },
        {
          name: "ImageRefToImageOutputs_B",
          size: 8,
          fields: [
            {
              name: "image",
              type: "Image_B",
              offset_within_container: 0,
              element_count: 1,
            },
          ],
        },
        {
          name: "Image_A",
          size: 8,
          fields: [
            {
              name: "data_buffer",
              type: "ImageByte",
              offset_within_container: 1000,
              element_count: 8,
            },
            {
              name: "count",
              type: "uint32_t",
              offset_within_container: 0,
              element_count: 1,
            },
          ],
        },
        {
          name: "Image_B",
          size: 8,
          fields: [
            {
              name: "data_buffer",
              type: "ImageByte",
              offset_within_container: 2000,
              element_count: 8,
            },
            {
              name: "count",
              type: "uint32_t",
              offset_within_container: 0,
              element_count: 1,
            },
          ],
        },
      ],
    };

    const raw = new ArrayBuffer(4096);
    const bytes = new Uint8Array(raw);
    const view = new DataView(raw);
    view.setUint32(100, 4, true);
    view.setUint32(200, 4, true);
    bytes.set([0xff, 0xd8, 0xaa, 0xd9], 1100);
    bytes.set([0xff, 0xd8, 0xbb, 0xd9], 2200);

    const model = createTelemetryModel(layout);
    model.raw = raw;

    const secondBuffer = model
      .getField?.("second.outputs.image.data_buffer")
      ?.getValue() as Uint8Array | null;
    expect(Array.from(secondBuffer?.slice(0, 4) ?? [])).toEqual([
      0xff,
      0xd8,
      0xbb,
      0xd9,
    ]);

    const secondJpegData = model
      .getField?.("second.outputs.image")
      ?.getValue() as { data_buffer?: Uint8Array; count?: number } | null;
    expect(secondJpegData?.count).toBe(4);
    expect(Array.from(secondJpegData?.data_buffer?.slice(0, 4) ?? [])).toEqual([
      0xff,
      0xd8,
      0xbb,
      0xd9,
    ]);
  });

  it("attaches incoming connection metadata to writable input fields", () => {
    const layout: LayoutModel = {
      engine_session_id: "sid",
      workloads_buffer_size_used: 0,
      workloads: [
        {
          name: "plain",
          type: "PlainWorkload",
          offset_within_container: 0,
          stats_offset_within_container: 64,
          inputs: {
            type: "PlainInputs",
            offset_within_container: 0,
          },
        },
      ],
      writable_inputs: [
        {
          field_handle: 11,
          field_path: "plain.inputs.enabled",
          type: "bool",
          size: 1,
          incoming_connection_handle: 21,
          incoming_connection_path: "plain.inputs.enabled",
          incoming_connection_enabled: true,
        },
      ],
      types: [
        { name: "bool", size: 1 },
        { name: "WorkloadInstanceStats", size: 32 },
        {
          name: "PlainInputs",
          size: 1,
          fields: [
            {
              name: "enabled",
              type: "bool",
              offset_within_container: 0,
              element_count: 1,
            },
          ],
        },
      ],
    };

    const model = createTelemetryModel(layout);
    const field = model.getField?.("plain.inputs.enabled");

    expect(field?.writable_input_handle).toBe(11);
    expect(field?.incoming_connection_handle).toBe(21);
    expect(field?.incoming_connection_enabled).toBe(true);
  });
});
