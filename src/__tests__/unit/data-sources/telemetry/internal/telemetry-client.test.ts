import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchLayout,
  setWorkloadInputFieldsData,
} from "../../../../../renderer/data-sources/telemetry/internal/telemetry-client";

type JsonResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<Record<string, unknown>>;
};

function createJsonResponse(
  status: number,
  body: Record<string, unknown>
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
        createJsonResponse(429, { error: "throttled", retry_after_ms: 1 })
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
      }
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

  it("keeps direct telemetry bases on the direct api route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(200, {
        workloads: [],
        types: [],
        workloads_buffer_size_used: 0,
        process_memory_used: 0,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchLayout("http://192.168.5.16:7102");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.5.16:7102/api/telemetry/workloads_buffer/layout",
      { cache: "no-store" }
    );
  });

  it("uses telemetry-gateway bases without duplicating the api prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(200, {
        workloads: [],
        types: [],
        workloads_buffer_size_used: 0,
        process_memory_used: 0,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchLayout("http://192.168.5.16:7102/api/telemetry-gateway/alf-e-face");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-face/workloads_buffer/layout",
      { cache: "no-store" }
    );
  });
});
