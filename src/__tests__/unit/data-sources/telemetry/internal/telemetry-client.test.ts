import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTelemetryModel,
  type LayoutModel,
  setWorkloadInputConnectionState,
  setWorkloadInputFieldsData,
} from "../../../../../renderer/data-sources/telemetry/internal/telemetry-client";
import { sendTelemetryWriteWs } from "../../../../../renderer/data-sources/telemetry/internal/telemetry-ws-client";

vi.mock(
  "../../../../../renderer/data-sources/telemetry/internal/telemetry-ws-client",
  () => ({
    sendTelemetryWriteWs: vi.fn(),
  }),
);

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
    const sendWriteMock = vi.mocked(sendTelemetryWriteWs);
    sendWriteMock
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

    expect(sendWriteMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("does not retry non-retryable status codes", async () => {
    const sendWriteMock = vi.mocked(sendTelemetryWriteWs);
    sendWriteMock.mockResolvedValue({
      ok: false,
      status: 400,
      body: { error: "bad_request" },
    });

    const result = await setWorkloadInputFieldsData("http://example", {
      engine_session_id: "sid",
      writes: [{ field_handle: 7, value: 123 }],
    });

    expect(sendWriteMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("retries once with the corrected engine session id on session mismatch", async () => {
    const sendWriteMock = vi.mocked(sendTelemetryWriteWs);
    sendWriteMock
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

    expect(sendWriteMock).toHaveBeenCalledTimes(2);
    expect(sendWriteMock.mock.calls[1]?.[1]?.engine_session_id).toBe(
      "sid-corrected",
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

});

describe("setWorkloadInputConnectionState", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("posts connection suppression updates over REST", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "processed",
          updates: [
            {
              field_handle: 7,
              incoming_connection_enabled: false,
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await setWorkloadInputConnectionState("http://example", {
      engine_session_id: "sid",
      updates: [{ field_handle: 7, enabled: false }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://example/api/telemetry/set_workload_input_connection_state",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
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

  it("attaches incoming connection metadata to writable input fields", () => {
    const layout: LayoutModel = {
      engine_session_id: "sid",
      workloads_buffer_size_used: 0,
      process_memory_used: 0,
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
