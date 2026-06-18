import { describe, expect, it, vi } from "vitest";
import {
  createElectronTelemetryService,
  ElectronTelemetryServiceError,
  type ElectronTelemetryServiceDependencies,
} from "../../main/telemetry/electron-telemetry-service";
import type { LayoutModel } from "../../common/telemetry/telemetry-decoder";

const layout: LayoutModel = {
  engine_session_id: "session-a",
  workloads_buffer_size_used: 16,
  process_memory_used: 4096,
  process_threads: [{ thread_id: 12, name: "barr-e-face main" }],
  workloads: [
    {
      name: "sequenced_group_workload_8F25A952",
      type: "sequenced_group_workload",
      offset_within_container: 0,
      stats_offset_within_container: 0,
    },
  ],
  types: [
    {
      name: "WorkloadInstanceStats",
      size: 4,
      fields: [
        {
          name: "tick_count",
          type: "uint32_t",
          offset_within_container: 0,
          element_count: 1,
        },
      ],
    },
  ],
};

function makeRawBuffer() {
  const raw = Buffer.alloc(16);
  raw.writeUInt32LE(42, 0);
  return raw;
}

function createFetchMock() {
  const raw = makeRawBuffer();
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/query/list-project-models")) {
      return new Response(JSON.stringify(["models/barr-e-face.model.yaml"]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/query/get-model")) {
      return new Response(
        JSON.stringify({
          id: "barr_e_face",
          name: "Barr.e Face",
          telemetry: { port: 9030, telemetry_push_rate_hz: 30 },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url === "http://localhost:9030/api/telemetry/workloads_buffer/layout") {
      return new Response(JSON.stringify(layout), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "http://localhost:9030/api/telemetry/workloads_buffer/raw") {
      return new Response(raw, {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Robotick-Frame-Seq": "17",
          "X-Robotick-Engine-Session-Id": "session-a",
        },
      });
    }
    if (url === "http://localhost:9030/api/telemetry/set_workload_input_fields_data") {
      return new Response(
        JSON.stringify({ status: "processed", accepted_count: 1 }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url === "http://localhost:9030/api/telemetry/set_workload_input_connection_state") {
      return new Response(JSON.stringify({ status: "processed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "http://localhost:9030/api/telemetry/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "http://localhost:9030/api/telemetry/push_stats") {
      return new Response(
        JSON.stringify({
          configured_push_rate_hz: 30,
          actual_push_rate_hz: 29.5,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return new Response(JSON.stringify({ error: "not_found", url }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function createService(overrides?: Partial<ElectronTelemetryServiceDependencies>) {
  const fetchMock = createFetchMock();
  const service = createElectronTelemetryService({
    getSelectedProjectPath: () => "/tmp/barr-e/barr-e.project.yaml",
    getHubEndpoint: () => "http://127.0.0.1:7000",
    fetch: fetchMock as unknown as typeof fetch,
    now: () => new Date("2026-06-17T12:00:00.000Z"),
    ...overrides,
  });
  return { service, fetchMock };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createElectronTelemetryService", () => {
  it("lists telemetry models from selected project state", async () => {
    const { service } = createService();

    await expect(service.listModels()).resolves.toMatchObject({
      resource_type: "robotick_studio_telemetry_models",
      project_path: "/tmp/barr-e/barr-e.project.yaml",
      models: [
        {
          model_id: "barr-e-face",
          display_name: "Barr.e Face",
          model_path: "models/barr-e-face.model.yaml",
          engine_model_id: "barr_e_face",
          telemetry_base_url: "http://localhost:9030",
          telemetry_push_rate_hz: 30,
        },
      ],
    });
  });

  it("fetches and caches a telemetry layout", async () => {
    const { service, fetchMock } = createService();

    await expect(service.getLayout("barr-e-face")).resolves.toMatchObject({
      resource_type: "robotick_studio_telemetry_model_layout",
      model: { model_id: "barr-e-face" },
      layout: { engine_session_id: "session-a" },
      loaded_at: "2026-06-17T12:00:00.000Z",
    });
    await service.getLayout("barr-e-face");

    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/api/telemetry/workloads_buffer/layout"),
      ),
    ).toHaveLength(1);
  });

  it("returns raw telemetry bytes and frame metadata", async () => {
    const { service } = createService();

    const response = await service.getRawBuffer("barr-e-face");

    expect(response).toMatchObject({
      resource_type: "robotick_studio_telemetry_model_raw_buffer",
      byte_length: 16,
      frame_seq: 17,
      engine_session_id: "session-a",
    });
    expect(response.body.readUInt32LE(0)).toBe(42);
  });

  it("produces decoded snapshot JSON from layout plus raw buffer", async () => {
    const { service } = createService();

    const snapshot = await service.getSnapshot("barr-e-face");

    expect(snapshot).toMatchObject({
      resource_type: "robotick_studio_telemetry_model_snapshot",
      source: {
        frame_seq: 17,
        engine_session_id: "session-a",
        raw_byte_length: 16,
      },
      process_threads: [{ threadId: 12, name: "barr-e-face main" }],
      workloads: [
        {
          name: "sequenced_group_workload_8F25A952",
          stats: {
            fields: {
              tick_count: { value: 42 },
            },
          },
        },
      ],
    });
  });

  it("throws a stable error code for unknown models", async () => {
    const { service } = createService();

    await expect(service.getSnapshot("missing")).rejects.toMatchObject({
      name: "ElectronTelemetryServiceError",
      code: "unknown_model",
      statusCode: 404,
    } satisfies Partial<ElectronTelemetryServiceError>);
  });

  it("posts writable telemetry input requests from Electron", async () => {
    const { service, fetchMock } = createService();

    await expect(
      service.setWorkloadInputFieldsDataForBaseUrl("http://localhost:9030", {
        engine_session_id: "session-a",
        writes: [{ field_handle: 7, value: 1 }],
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: 200,
      body: { status: "processed" },
    });
    await expect(
      service.setWorkloadInputConnectionStateForBaseUrl("http://localhost:9030", {
        engine_session_id: "session-a",
        updates: [{ field_handle: 7, enabled: false }],
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: 200,
      body: { status: "processed" },
    });

    expect(
      fetchMock.mock.calls.map(([url]) => String(url)),
    ).toEqual(
      expect.arrayContaining([
        "http://localhost:9030/api/telemetry/set_workload_input_fields_data",
        "http://localhost:9030/api/telemetry/set_workload_input_connection_state",
      ]),
    );
  });

  it("reads telemetry health and push stats from Electron", async () => {
    const { service, fetchMock } = createService();

    await expect(
      service.getHealthForBaseUrl("http://localhost:9030"),
    ).resolves.toMatchObject({
      ok: true,
      status: 200,
      body: { status: "ok" },
    });
    await expect(
      service.getPushStatsForBaseUrl("http://localhost:9030"),
    ).resolves.toMatchObject({
      ok: true,
      status: 200,
      body: {
        configured_push_rate_hz: 30,
        actual_push_rate_hz: 29.5,
      },
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        "http://localhost:9030/api/telemetry/health",
        "http://localhost:9030/api/telemetry/push_stats",
      ]),
    );
  });

  it("shares one Electron websocket across same-base-url subscribers", async () => {
    const sockets: Array<{
      binaryType: string;
      readyState: number;
      onopen: ((event: unknown) => void) | null;
      onmessage: ((event: { data: unknown }) => void) | null;
      onerror: ((event: unknown) => void) | null;
      onclose: ((event: unknown) => void) | null;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    const { service } = createService({
      webSocketFactory: vi.fn((url: string) => {
        expect(url).toBe("ws://localhost:9030/api/telemetry/ws");
        const socket = {
          binaryType: "",
          readyState: 1,
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          close: vi.fn(),
        };
        sockets.push(socket);
        return socket;
      }),
    });
    const firstEvents: unknown[] = [];
    const secondEvents: unknown[] = [];

    const unsubscribeFirst = service.subscribeBaseUrl("http://localhost:9030", (event) => {
      firstEvents.push(event);
    });
    const unsubscribeSecond = service.subscribeBaseUrl("http://localhost:9030", (event) => {
      secondEvents.push(event);
    });

    expect(sockets).toHaveLength(1);
    sockets[0]?.onmessage?.({
      data: JSON.stringify({ type: "layout", layout }),
    });
    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        type: "frame",
        engine_session_id: "session-a",
        frame_seq: 22,
      }),
    });
    sockets[0]?.onmessage?.({ data: makeRawBuffer() });
    await flushMicrotasks();

    expect(firstEvents).toEqual([
      expect.objectContaining({ type: "layout" }),
      expect.objectContaining({
        type: "frame",
        payload: expect.objectContaining({ sid: "session-a", frameSeq: 22 }),
      }),
    ]);
    expect(secondEvents).toEqual(firstEvents);

    unsubscribeFirst();
    expect(sockets[0]?.close).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("pairs websocket frame metadata with binary payloads in order under backpressure", async () => {
    const sockets: Array<{
      binaryType: string;
      readyState: number;
      onopen: ((event: unknown) => void) | null;
      onmessage: ((event: { data: unknown }) => void) | null;
      onerror: ((event: unknown) => void) | null;
      onclose: ((event: unknown) => void) | null;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    const { service } = createService({
      webSocketFactory: vi.fn(() => {
        const socket = {
          binaryType: "",
          readyState: 1,
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          close: vi.fn(),
        };
        sockets.push(socket);
        return socket;
      }),
    });
    const events: unknown[] = [];

    service.subscribeBaseUrl("http://localhost:9030", (event) => {
      events.push(event);
    });

    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        type: "frame",
        engine_session_id: "session-a",
        frame_seq: 22,
      }),
    });
    sockets[0]?.onmessage?.({ data: makeRawBuffer() });
    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        type: "frame",
        engine_session_id: "session-a",
        frame_seq: 24,
      }),
    });
    sockets[0]?.onmessage?.({ data: makeRawBuffer() });
    await flushMicrotasks();

    const frameSeqs = events
      .filter(
        (event): event is { type: "frame"; payload: { frameSeq: number } } =>
          Boolean(event) &&
          typeof event === "object" &&
          (event as { type?: unknown }).type === "frame",
      )
      .map((event) => event.payload.frameSeq);
    expect(frameSeqs).toEqual([22, 24]);
  });
});
