import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setWorkloadInputFieldData } from "../../../../../renderer/data-sources/telemetry/internal/telemetry-client";

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

describe("setWorkloadInputFieldData", () => {
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

    const requestPromise = setWorkloadInputFieldData(
      "http://example",
      {
        engine_session_id: "sid",
        field_handle: 1,
        value: true,
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

    const result = await setWorkloadInputFieldData("http://example", {
      engine_session_id: "sid",
      field_handle: 7,
      value: 123,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });
});
