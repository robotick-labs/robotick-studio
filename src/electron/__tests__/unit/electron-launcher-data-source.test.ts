import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElectronLauncherDataSource } from "../../main/data-sources/launcher/electron-launcher-data-source";

function createJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function createModel(
  name: string,
  port: number,
  preferredHost: string,
  options: {
    modelId?: string;
    isGateway?: boolean;
    telemetryPushRateHz?: number;
  } = {},
) {
  return {
    name,
    id: options.modelId ?? "",
    telemetry: {
      port,
      ...(options.telemetryPushRateHz
        ? { telemetry_push_rate_hz: options.telemetryPushRateHz }
        : {}),
      ...(options.isGateway ? { is_gateway: true } : {}),
    },
    runtime: {
      preferred_host: preferredHost,
    },
  };
}

function createDataSource() {
  return createElectronLauncherDataSource({
    getWorkspaceRoot: () => "/workspace",
    getStaticHubEndpoint: () => "http://127.0.0.1:44493",
    getHubEndpoint: async () => "http://127.0.0.1:53401",
  });
}

describe("electron-launcher-data-source", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("routes model telemetry through the declared gateway when the registry is available", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const projectPath = url.searchParams.get("project_path");
      const modelPath = url.searchParams.get("model_path");

      if (path === "/query/list-project-models") {
        expect(projectPath).toBe("/tmp/sample-robot");
        return createJsonResponse([
          "models/sample-robot-face.model.yaml",
          "models/sample-robot-spine.model.yaml",
        ]);
      }
      if (
        path === "/query/get-model" &&
        modelPath === "models/sample-robot-face.model.yaml"
      ) {
        return createJsonResponse(
          createModel("SampleBot Face", 7103, "192.168.5.16", {
            modelId: "sample-robot-face",
            isGateway: true,
          }),
        );
      }
      if (
        path === "/query/get-model" &&
        modelPath === "models/sample-robot-spine.model.yaml"
      ) {
        return createJsonResponse(
          createModel("SampleBot Spine", 7104, "10.42.0.2", {
            modelId: "sample-robot-spine",
          }),
        );
      }
      if (path === "/api/telemetry-gateway/models") {
        expect(url.origin).toBe("http://192.168.5.16:7103");
        return createJsonResponse({
          gateway_model_id: "sample-robot-face",
          models: [
            {
              model_id: "sample-robot-face",
              telemetry_path: "/api/telemetry-gateway/sample-robot-face",
            },
            {
              model_id: "sample-robot-spine",
              telemetry_path: "/api/telemetry-gateway/sample-robot-spine",
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    const dataSource = createDataSource();

    const models = await dataSource.refreshProjectModels(
      "/tmp/sample-robot",
      "native:ALL",
    );
    const byName = new Map(
      models.map((model) => [model.modelShortName, model]),
    );

    expect(byName.get("sample-robot-face")?.telemetryBaseUrl).toBe(
      "http://192.168.5.16:7103/api/telemetry-gateway/sample-robot-face",
    );
    expect(byName.get("sample-robot-spine")?.telemetryBaseUrl).toBe(
      "http://192.168.5.16:7103/api/telemetry-gateway/sample-robot-spine",
    );
  });

  it("falls back to synthesized gateway telemetry urls when the registry is unavailable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const modelPath = url.searchParams.get("model_path");

      if (path === "/query/list-project-models") {
        return createJsonResponse([
          "models/sample-robot-face.model.yaml",
          "models/sample-robot-spine.model.yaml",
        ]);
      }
      if (
        path === "/query/get-model" &&
        modelPath === "models/sample-robot-face.model.yaml"
      ) {
        return createJsonResponse(
          createModel("SampleBot Face", 7103, "192.168.5.16", {
            modelId: "sample-robot-face",
            isGateway: true,
          }),
        );
      }
      if (
        path === "/query/get-model" &&
        modelPath === "models/sample-robot-spine.model.yaml"
      ) {
        return createJsonResponse(
          createModel("SampleBot Spine", 7104, "10.42.0.2", {
            modelId: "sample-robot-spine",
          }),
        );
      }
      if (path === "/api/telemetry-gateway/models") {
        return {
          ok: false,
          status: 503,
          statusText: "Unavailable",
          json: async () => ({}),
          text: async () => "gateway unavailable",
        };
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    const dataSource = createDataSource();

    const models = await dataSource.refreshProjectModels(
      "/tmp/sample-robot",
      "native:ALL",
    );
    const byName = new Map(
      models.map((model) => [model.modelShortName, model]),
    );

    expect(byName.get("sample-robot-face")?.telemetryBaseUrl).toBe(
      "http://192.168.5.16:7103/api/telemetry-gateway/sample-robot-face",
    );
    expect(byName.get("sample-robot-spine")?.telemetryBaseUrl).toBe(
      "http://192.168.5.16:7103/api/telemetry-gateway/sample-robot-spine",
    );
  });

  it("uses gateway telemetry routes when a gateway model exists for local launcher profiles", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const modelPath = url.searchParams.get("model_path");

      if (path === "/query/list-project-models") {
        return createJsonResponse([
          "models/sample-robot-face.model.yaml",
          "models/sample-robot-spine.model.yaml",
        ]);
      }
      if (
        path === "/query/get-model" &&
        modelPath === "models/sample-robot-face.model.yaml"
      ) {
        return createJsonResponse(
          createModel("SampleBot Face", 7103, "192.168.5.16", {
            modelId: "sample-robot-face",
            isGateway: true,
          }),
        );
      }
      if (
        path === "/query/get-model" &&
        modelPath === "models/sample-robot-spine.model.yaml"
      ) {
        return createJsonResponse(
          createModel("SampleBot Spine", 7104, "10.42.0.2", {
            modelId: "sample-robot-spine",
          }),
        );
      }
      if (path === "/api/telemetry-gateway/models") {
        expect(url.origin).toBe("http://localhost:7103");
        return createJsonResponse({
          models: [
            {
              model_id: "sample-robot-face",
              telemetry_path: "/api/telemetry-gateway/sample-robot-face",
            },
            {
              model_id: "sample-robot-spine",
              telemetry_path: "/api/telemetry-gateway/sample-robot-spine",
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    const dataSource = createDataSource();
    const models = await dataSource.refreshProjectModels(
      "/tmp/sample-robot",
      "local:ALL",
    );

    expect(
      models.find((m) => m.modelShortName === "sample-robot-spine")
        ?.telemetryBaseUrl,
    ).toBe("http://localhost:7103/api/telemetry-gateway/sample-robot-spine");
  });

  it("rejects gateway telemetry routing when a model is missing a stable id", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const modelPath = url.searchParams.get("model_path");

      if (path === "/query/list-project-models") {
        return createJsonResponse([
          "models/sample-robot-face.model.yaml",
          "models/sample-robot-spine.model.yaml",
        ]);
      }
      if (
        path === "/query/get-model" &&
        modelPath === "models/sample-robot-face.model.yaml"
      ) {
        return createJsonResponse(
          createModel("SampleBot Face", 7103, "192.168.5.16", {
            modelId: "sample-robot-face",
            isGateway: true,
          }),
        );
      }
      if (
        path === "/query/get-model" &&
        modelPath === "models/sample-robot-spine.model.yaml"
      ) {
        return createJsonResponse(
          createModel("SampleBot Spine", 7104, "10.42.0.2"),
        );
      }
      if (path === "/api/telemetry-gateway/models") {
        return createJsonResponse({
          models: [
            {
              model_id: "sample-robot-face",
              telemetry_path: "/api/telemetry-gateway/sample-robot-face",
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    const dataSource = createDataSource();

    await expect(
      dataSource.refreshProjectModels("/tmp/sample-robot", "native:ALL"),
    ).rejects.toThrow("missing required 'id'");
  });

  it("resolves stored project basenames to absolute project paths before run requests", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));

        if (url.pathname === "/query/list-projects") {
          return createJsonResponse([
            "robots/sample-robot/sample-robot.project.yaml",
          ]);
        }
        if (url.pathname === "/v1/launcher/models/start") {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({
            project_name: "sample-robot",
            profile: "native:ALL",
            creator: {
              client: "studio",
            },
          });
          return createJsonResponse({ sessions: [] });
        }
        throw new Error(`Unexpected fetch: ${url.toString()}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    const dataSource = createDataSource();

    await dataSource.requestLauncherRun(
      "sample-robot.project.yaml",
      "native:ALL",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces telemetry push rate from model yaml and defaults missing values to 20Hz", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const modelPath = url.searchParams.get("model_path");

      if (path === "/query/list-project-models") {
        return createJsonResponse([
          "models/sample-robot-spine.model.yaml",
          "models/sample-robot-face.model.yaml",
        ]);
      }
      if (
        path === "/query/get-model" &&
        modelPath === "models/sample-robot-spine.model.yaml"
      ) {
        return createJsonResponse(
          createModel("SampleBot Spine", 7104, "10.42.0.2", {
            telemetryPushRateHz: 7.5,
          }),
        );
      }
      if (
        path === "/query/get-model" &&
        modelPath === "models/sample-robot-face.model.yaml"
      ) {
        return createJsonResponse({
          ...createModel("SampleBot Face", 7103, "10.42.0.3"),
          telemetry: {
            port: 7103,
            preferred_sample_rate_hz: 3.5,
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    const dataSource = createDataSource();
    const models = await dataSource.refreshProjectModels(
      "/tmp/sample-robot",
      "native:ALL",
    );
    const byPath = new Map(models.map((model) => [model.modelPath, model]));

    expect(
      byPath.get("models/sample-robot-spine.model.yaml")?.telemetryPushRateHz,
    ).toBe(7.5);
    expect(
      byPath.get("models/sample-robot-face.model.yaml")?.telemetryPushRateHz,
    ).toBe(20);
  });

  it("loads workloads registry metadata for a project and target", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname !== "/query/get-workloads-registry") {
        throw new Error(`Unexpected fetch: ${url.toString()}`);
      }
      expect(url.searchParams.get("project_path")).toBe("/tmp/sample-robot");
      expect(url.searchParams.get("target")).toBe("linux");
      return createJsonResponse({
        project: "/tmp/sample-robot",
        target: "linux",
        registry: [
          {
            type: "SampleWorkload",
          },
        ],
      });
    });

    vi.stubGlobal("fetch", fetchMock);
    const dataSource = createDataSource();
    const result = await dataSource.fetchProjectWorkloadsRegistry(
      "/tmp/sample-robot",
      "linux",
    );

    expect(result.registry).toHaveLength(1);
  });

  it("builds runtime status, log urls, log snapshots, and diagnostics from launcher responses", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/v1/launcher/runtime") {
          return createJsonResponse({
            resource_type: "robotick_launcher_runtime_status",
            state: "running",
            models: [
              {
                project_id: "barr-e",
                model_id: "barr-e-face",
                lifecycle: "running",
                readiness: "ready",
                freshness: "live",
              },
            ],
          });
        }
        if (url.pathname === "/v1/launcher/models/logs") {
          expect(url.searchParams.get("project_id")).toBe("barr-e");
          expect(url.searchParams.get("tail")).toBe("50");
          return createJsonResponse({
            resource_type: "robotick_launcher_model_logs_batch",
            project_id: "barr-e",
            models: [],
          });
        }
        if (url.pathname === "/v1/launcher/models/logs/clear") {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({
            project_id: "barr-e",
          });
          return createJsonResponse({ cleared_models: [] });
        }
        throw new Error(`Unexpected fetch: ${url.toString()}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    const dataSource = createDataSource();

    await expect(
      dataSource.fetchLauncherStatus(
        "/workspace/robots/barr-e/barr-e.project.yaml",
        "native:ALL",
      ),
    ).resolves.toMatchObject({
      status: "running",
      models: {
        "barr-e-face": {
          status: "running",
          readiness: "ready",
        },
      },
    });

    await expect(
      dataSource.getLauncherLogStreamUrl(
        "/workspace/robots/barr-e/barr-e.project.yaml",
      ),
    ).resolves.toBe(
      "ws://127.0.0.1:53401/v1/launcher/models/logs/stream?project_id=barr-e",
    );
    await expect(
      dataSource.fetchLauncherLogSnapshot(
        "/workspace/robots/barr-e/barr-e.project.yaml",
        50,
      ),
    ).resolves.toMatchObject({
      project_id: "barr-e",
      models: [],
    });
    await expect(
      dataSource.getDiagnostics(
        "/workspace/robots/barr-e/barr-e.project.yaml",
        "native:ALL",
      ),
    ).resolves.toMatchObject({
      launcher_api_base: "http://127.0.0.1:53401",
      terminal_log_stream_url:
        "ws://127.0.0.1:53401/v1/launcher/models/logs/stream?project_id=barr-e",
    });
    await dataSource.requestLauncherLogClear(
      "/workspace/robots/barr-e/barr-e.project.yaml",
    );
  });

  it("keeps aggregate launcher status running when one model restarts while another remains live", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/launcher/runtime") {
        return createJsonResponse({
          resource_type: "robotick_launcher_runtime_status",
          state: "running",
          models: [
            {
              project_id: "barr-e",
              model_id: "barr-e-face",
              lifecycle: "running",
              readiness: "ready",
              freshness: "live",
            },
            {
              project_id: "barr-e",
              model_id: "barr-e-spine",
              lifecycle: "stopping",
              readiness: "pending",
              freshness: "pending",
              operation: {
                action: "restarting",
                phase: "stopping",
                request_id: "restart-barr-e-spine",
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    const dataSource = createDataSource();

    await expect(
      dataSource.fetchLauncherStatus(
        "/workspace/robots/barr-e/barr-e.project.yaml",
        "native:ALL",
      ),
    ).resolves.toMatchObject({
      status: "running",
      phase: "run",
      models: {
        "barr-e-face": {
          status: "running",
        },
        "barr-e-spine": {
          status: "stopping",
          operation: {
            action: "restarting",
            phase: "stopping",
            request_id: "restart-barr-e-spine",
          },
        },
      },
    });
  });

  it("shares rapid runtime status reads through the Electron data-source cache", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/launcher/runtime") {
        return createJsonResponse({
          resource_type: "robotick_launcher_runtime_status",
          state: "running",
          models: [
            {
              project_id: "barr-e",
              model_id: "barr-e-face",
              lifecycle: "running",
              readiness: "ready",
              freshness: "live",
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    const dataSource = createDataSource();

    await dataSource.fetchLauncherStatus(
      "/workspace/robots/barr-e/barr-e.project.yaml",
      "native:ALL",
    );
    await dataSource.fetchLauncherStatus(
      "/workspace/robots/barr-e/barr-e.project.yaml",
      "native:ALL",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(
      dataSource.getDiagnostics(
        "/workspace/robots/barr-e/barr-e.project.yaml",
        "native:ALL",
      ),
    ).resolves.toMatchObject({
      status_cache: {
        project_path: "/workspace/robots/barr-e/barr-e.project.yaml",
        launcher_profile: "native:ALL",
        hit_count: 1,
        miss_count: 1,
      },
    });
  });

  it("coalesces concurrent runtime status reads", async () => {
    let resolveFetch:
      ((value: ReturnType<typeof createJsonResponse>) => void) | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/launcher/runtime") {
        return new Promise<ReturnType<typeof createJsonResponse>>((resolve) => {
          resolveFetch = resolve;
        });
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    const dataSource = createDataSource();

    const first = dataSource.fetchLauncherStatus(
      "/workspace/robots/barr-e/barr-e.project.yaml",
      "native:ALL",
    );
    const second = dataSource.fetchLauncherStatus(
      "/workspace/robots/barr-e/barr-e.project.yaml",
      "native:ALL",
    );

    for (
      let index = 0;
      index < 10 && fetchMock.mock.calls.length === 0;
      index += 1
    ) {
      await Promise.resolve();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch?.(
      createJsonResponse({
        resource_type: "robotick_launcher_runtime_status",
        state: "running",
        models: [
          {
            project_id: "barr-e",
            model_id: "barr-e-face",
            lifecycle: "running",
            readiness: "ready",
            freshness: "live",
          },
        ],
      }),
    );

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: "running" }),
      expect.objectContaining({ status: "running" }),
    ]);
  });

  it("keeps the last launcher status snapshot when a later runtime read fails", async () => {
    vi.useFakeTimers();
    let failNextFetch = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/launcher/runtime") {
        if (failNextFetch) {
          throw new Error("hub unavailable");
        }
        return createJsonResponse({
          resource_type: "robotick_launcher_runtime_status",
          state: "running",
          models: [
            {
              project_id: "barr-e",
              model_id: "barr-e-face",
              lifecycle: "running",
              readiness: "ready",
              freshness: "live",
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    const dataSource = createDataSource();

    await expect(
      dataSource.fetchLauncherStatus(
        "/workspace/robots/barr-e/barr-e.project.yaml",
        "native:ALL",
      ),
    ).resolves.toMatchObject({ status: "running" });

    failNextFetch = true;
    vi.advanceTimersByTime(1100);

    await expect(
      dataSource.fetchLauncherStatus(
        "/workspace/robots/barr-e/barr-e.project.yaml",
        "native:ALL",
      ),
    ).resolves.toMatchObject({
      status: "running",
      models: {
        "barr-e-face": {
          status: "running",
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
