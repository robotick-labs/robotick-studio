import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTelemetryModel,
  fetchLayout,
  type LayoutModel,
  setWorkloadInputFieldsData,
} from "../../../../../renderer/data-sources/telemetry/internal/telemetry-client";

type JsonResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<Record<string, unknown>>;
};

function createJsonResponse(
  status: number,
  body: Record<string, unknown>,
): JsonResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("setWorkloadInputFieldsData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("retries on retryable status and eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse(429, { error: "throttled", retry_after_ms: 1 }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, { status: "accepted" }));
    vi.stubGlobal("fetch", fetchMock);

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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("does not retry non-retryable status codes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(createJsonResponse(400, { error: "bad_request" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await setWorkloadInputFieldsData("http://example", {
      engine_session_id: "sid",
      writes: [{ field_handle: 7, value: 123 }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("retries once with the corrected engine session id on session mismatch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse(412, {
          error: "session_mismatch",
          engine_session_id: "sid-corrected",
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, { status: "processed", accepted_count: 1 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await setWorkloadInputFieldsData("http://example", {
      engine_session_id: "sid-stale",
      writes: [{ field_handle: 7, value: 0.5 }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).engine_session_id,
    ).toBe("sid-corrected");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("keeps direct telemetry bases on the direct api route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(200, {
        workloads: [],
        types: [],
        workloads_buffer_size_used: 0,
        process_memory_used: 0,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchLayout("http://192.168.5.16:7102");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.5.16:7102/api/telemetry/workloads_buffer/layout",
      { cache: "no-store" },
    );
  });

  it("uses telemetry-gateway bases without duplicating the api prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(200, {
        workloads: [],
        types: [],
        workloads_buffer_size_used: 0,
        process_memory_used: 0,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchLayout(
      "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-face",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-face/workloads_buffer/layout",
      { cache: "no-store" },
    );
  });

  it("rejects successful non-layout payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(200, {
        error: "telemetry_layout_generation_failed",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const layout = await fetchLayout(
      "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-spine",
    );

    expect(layout).toBeNull();
  });
});

describe("createTelemetryModel", () => {
  it("computes per-workload static and dynamic workloads-buffer memory", () => {
    const layout: LayoutModel = {
      engine_session_id: "sid",
      workloads_buffer_size_used: 0,
      process_memory_used: 0,
      workloads: [
        {
          name: "jpeg",
          type: "ImageRefToJpegWorkload",
          offset_within_container: 100,
          stats_offset_within_container: 1000,
          config: {
            type: "ImageRefToJpegConfig",
            offset_within_container: 16,
          },
          outputs: {
            type: "ImageRefToJpegOutputs",
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
          name: "ImageRefToJpegConfig",
          size: 8,
          fields: [
            {
              name: "jpeg_data",
              type: "DynamicStructStorageVector_uint8_t_256",
              offset_within_container: 0,
              element_count: 1,
            },
          ],
        },
        {
          name: "ImageRefToJpegOutputs",
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
      process_memory_used: 0,
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
});
