import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readStorageValue,
  setStorageValue,
} from "../../../../renderer/services/storage";

vi.mock("../../../../renderer/services/storage", () => ({
  readStorageValue: vi.fn(() => ""),
  setStorageValue: vi.fn(),
}));

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

describe("launcher-interface gateway telemetry resolution", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
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

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    const models = await launcherInterface.refreshProjectModels("/tmp/sample-robot");
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

  it("falls back to synthesized gateway telemetry urls when the gateway registry is unavailable", async () => {
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

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    const models = await launcherInterface.refreshProjectModels("/tmp/sample-robot");
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

  it("uses gateway telemetry routes when a gateway model exists, even for local launcher profiles", async () => {
    vi.mocked(readStorageValue).mockImplementation((key: string) => {
      if (key === "robotick-studio.launcherProfile") {
        return "local:ALL";
      }
      return "";
    });

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

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    const models = await launcherInterface.refreshProjectModels("/tmp/sample-robot");
    const byName = new Map(
      models.map((model) => [model.modelShortName, model]),
    );

    expect(byName.get("sample-robot-face")?.telemetryBaseUrl).toBe(
      "http://localhost:7103/api/telemetry-gateway/sample-robot-face",
    );
    expect(byName.get("sample-robot-spine")?.telemetryBaseUrl).toBe(
      "http://localhost:7103/api/telemetry-gateway/sample-robot-spine",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:7103/api/telemetry-gateway/models",
      undefined,
    );
  });

  it("invalidates cached model descriptors when the launcher profile changes", async () => {
    let launcherProfile = "native:ALL";
    vi.mocked(readStorageValue).mockImplementation((key: string) => {
      if (key === "robotick-studio.launcherProfile") {
        return launcherProfile;
      }
      return "";
    });

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
        return createJsonResponse({
          gateway_model_id: "sample-robot-face",
          models: [
            {
              model_id: "sample-robot-face",
              telemetry_path: "/api/telemetry-gateway/sample-robot-face",
            },
            { model_id: "sample-robot-spine", telemetry_path: "/api/telemetry-gateway/sample-robot-spine" },
          ],
        });
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    const nativeModels = await launcherInterface.getProjectModels("/tmp/sample-robot");
    expect(
      nativeModels.find((model) => model.modelShortName === "sample-robot-spine")
        ?.telemetryBaseUrl,
    ).toBe("http://192.168.5.16:7103/api/telemetry-gateway/sample-robot-spine");

    launcherProfile = "local:ALL";
    launcherInterface.default.setLauncherProfile("local:ALL");

    const localModels = await launcherInterface.getProjectModels("/tmp/sample-robot");
    expect(
      localModels.find((model) => model.modelShortName === "sample-robot-spine")
        ?.telemetryBaseUrl,
    ).toBe("http://localhost:7103/api/telemetry-gateway/sample-robot-spine");
    expect(setStorageValue).toHaveBeenCalledWith(
      "robotick-studio.launcherProfile",
      "local:ALL",
    );
  });

  it("joins routed telemetry urls without duplicating the api prefix", async () => {
    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    expect(
      launcherInterface.buildUrl(
        "http://192.168.5.16:7103/api/telemetry-gateway/sample-robot-face",
        "/api/telemetry/workloads_buffer/layout",
      ),
    ).toBe(
      "http://192.168.5.16:7103/api/telemetry-gateway/sample-robot-face/workloads_buffer/layout",
    );
  });

  it("rejects gateway telemetry routing when a model is missing stable id", async () => {
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
          gateway_model_id: "sample-robot-face",
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

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await expect(
      launcherInterface.refreshProjectModels("/tmp/sample-robot"),
    ).rejects.toThrow("missing required 'id'");
  });

  it("builds routed telemetry websocket urls without duplicating the api prefix", async () => {
    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    expect(
      launcherInterface.buildWebSocketUrl(
        "http://192.168.5.16:7103/api/telemetry-gateway/sample-robot-face",
        "/api/telemetry/ws",
      ),
    ).toBe("ws://192.168.5.16:7103/api/telemetry-gateway/sample-robot-face/ws");
  });

  it("resolves stored project basenames to absolute project paths before run requests", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));

        if (url.pathname === "/query/list-projects") {
          return createJsonResponse(["robots/sample-robot/sample-robot.project.yaml"]);
        }

        if (url.pathname === "/v1/launcher/models/launch") {
          expect(init?.method).toBe("POST");
          expect(init?.headers).toEqual({
            "Content-Type": "application/json",
          });
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
    window.robotick = {
      environment: {
        isStandaloneApp: true,
        appTitle: "Robotick Studio",
        workspaceRoot: "/workspace",
      },
    };

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await launcherInterface.requestLauncherRun(
      "sample-robot.project.yaml",
      "native:ALL",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses live runtime projection", async () => {
    vi.mocked(readStorageValue).mockImplementation((key: string) => {
      if (key === "robotick-studio.projectPath") {
        return "/workspace/robots/sample-robot/sample-robot.project.yaml";
      }
      if (key === "robotick-studio.launcherProfile") {
        return "local:ALL";
      }
      return "";
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname !== "/v1/launcher/runtime") {
        throw new Error(`Unexpected fetch: ${url.toString()}`);
      }
      expect(url.searchParams.get("project_id")).toBe("sample-robot");
      return createJsonResponse({
        resource_type: "robotick_launcher_runtime_status",
        state: "stopped",
        models: [
          {
            project_id: "sample-robot",
            model_id: "sample-robot-face",
            lifecycle: "stopped",
            readiness: "pending",
            freshness: "stopped",
            pid_alive: false,
            health: {
              configured: true,
              healthy: false,
              error: "connection refused",
            },
          },
        ],
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await expect(launcherInterface.fetchLauncherStatus()).resolves.toEqual({
      status: "stopped",
      phase: null,
      profile: "local:ALL",
      models: {
        "sample-robot-face": {
          stage: "stop",
          status: "succeeded",
          lifecycle: "stopped",
          readiness: "pending",
          freshness: "stopped",
          logRefs: [],
        },
      },
    });
  });

  it("stops the current project through the model control endpoint", async () => {
    vi.mocked(readStorageValue).mockImplementation((key: string) => {
      if (key === "robotick-studio.projectPath") {
        return "/workspace/robots/sample-robot/sample-robot.project.yaml";
      }
      return "";
    });

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/v1/launcher/models/stop") {
          expect(init?.method).toBe("POST");
          expect(init?.headers).toEqual({
            "Content-Type": "application/json",
          });
          expect(JSON.parse(String(init?.body))).toEqual({
            project_name: "sample-robot",
          });
          return createJsonResponse({ stopped_models: ["sample-robot-face"] });
        }
        throw new Error(`Unexpected fetch: ${url.toString()}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await launcherInterface.requestLauncherStop();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops one model through the model control endpoint", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/v1/launcher/models/stop") {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({
            project_name: "sample-robot",
            model_ids: ["sample-robot-face"],
          });
          return createJsonResponse({ stopped_models: ["sample-robot-face"] });
        }
        throw new Error(`Unexpected fetch: ${url.toString()}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await launcherInterface.requestLauncherStopModel(
      "/workspace/robots/sample-robot/sample-robot.project.yaml",
      "native",
      "sample-robot-face",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reduces launcher status from runtime models", async () => {
    const readStorage = vi.mocked(readStorageValue);
    readStorage.mockImplementation((key: string) => {
      if (key === "robotick-studio.projectPath") {
        return "/workspace/robots/sample-robot/sample-robot.project.yaml";
      }
      if (key === "robotick-studio.launcherProfile") {
        return "native:ALL";
      }
      return "";
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname !== "/v1/launcher/runtime") {
        throw new Error(`Unexpected fetch: ${url.toString()}`);
      }
      expect(url.searchParams.get("project_id")).toBe("sample-robot");
      return createJsonResponse({
        resource_type: "robotick_launcher_runtime_status",
        state: "stopped",
        models: [
          {
            project_id: "sample-robot",
            model_id: "sample-robot-face",
            lifecycle: "stopped",
            freshness: "stopped",
          },
        ],
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await expect(launcherInterface.fetchLauncherStatus()).resolves.toEqual({
      status: "stopped",
      phase: null,
      profile: "native:ALL",
      models: {
        "sample-robot-face": {
          stage: "stop",
          status: "succeeded",
          lifecycle: "stopped",
          freshness: "stopped",
          logRefs: [],
        },
      },
    });
    readStorage.mockImplementation(() => "");
  });

  it("resolves absolute project directories to project yaml paths before settings requests", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        const url = new URL(String(input));

        if (url.pathname === "/query/list-projects") {
          return createJsonResponse([
            "robots/sample-robot/sample-robot.project.yaml",
          ]);
        }

        if (url.pathname === "/query/get-project-settings") {
          expect(url.searchParams.get("project_path")).toBe(
            "/workspace/robots/sample-robot/sample-robot.project.yaml",
          );
          return createJsonResponse({
            name: "Sample Robot",
          });
        }

        throw new Error(`Unexpected fetch: ${url.toString()}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    window.robotick = {
      environment: {
        isStandaloneApp: true,
        appTitle: "Robotick Studio",
        workspaceRoot: "/workspace",
      },
    };

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await expect(
      launcherInterface.fetchProjectSettingsData(
        "/workspace/robots/sample-robot",
      ),
    ).resolves.toEqual({
      name: "Sample Robot",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces telemetry push rate from model yaml", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const modelPath = url.searchParams.get("model_path");

      if (path === "/query/list-project-models") {
        return createJsonResponse(["models/sample-robot-spine.model.yaml"]);
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

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    const models = await launcherInterface.refreshProjectModels("/tmp/sample-robot");

    expect(models).toHaveLength(1);
    expect(models[0]?.telemetryPushRateHz).toBe(7.5);
  });

  it("defaults telemetry push rate to 20Hz and ignores legacy preferred_sample_rate_hz", async () => {
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
          createModel("SampleBot Spine", 7104, "10.42.0.2"),
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

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    const models = await launcherInterface.refreshProjectModels("/tmp/sample-robot");
    expect(models).toHaveLength(2);

    const byPath = new Map(models.map((model) => [model.modelPath, model]));
    expect(byPath.get("models/sample-robot-spine.model.yaml")?.telemetryPushRateHz).toBe(20);
    expect(byPath.get("models/sample-robot-face.model.yaml")?.telemetryPushRateHz).toBe(20);
  });

  it("loads workloads registry metadata for a project/target", async () => {
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
            metadata: {
              name: "SampleWorkload",
              structs: {
                config: {
                  name: "SampleConfig",
                  fields: [{ name: "enabled", type: "bool", default: "true" }],
                },
              },
            },
          },
        ],
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");
    const result = await launcherInterface.fetchProjectWorkloadsRegistry(
      "/tmp/sample-robot",
      "linux"
    );

    expect(result.registry).toHaveLength(1);
    expect(result.registry[0]?.type).toBe("SampleWorkload");
  });

  it("uses robotick-hub as the launcher transport base when exposed in the renderer environment", async () => {
    vi.stubGlobal("window", {
      robotick: {
        environment: {
          hubEndpoint: "http://127.0.0.1:44493",
        },
      },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/launcher/runtime") {
        expect(url.origin).toBe("http://127.0.0.1:44493");
        return createJsonResponse({
          resource_type: "robotick_launcher_runtime_status",
          state: "stopped",
          models: [],
        });
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await expect(launcherInterface.fetchLauncherStatus()).resolves.toEqual({
      status: "stopped",
      phase: null,
      profile: null,
      models: {},
    });
    expect(launcherInterface.getLauncherLogStreamUrl()).toBe("");
    expect(
      launcherInterface.buildProjectAssetUrl(
        "/tmp/demo/demo.project.yaml",
        "assets/demo.glb"
      )
    ).toContain("http://127.0.0.1:44493/query/project-assets/assets/demo.glb");
  });

  it("builds and uses hub-backed per-model log resources for the selected project", async () => {
    vi.mocked(readStorageValue).mockImplementation((key: string) => {
      if (key === "robotick-studio.projectPath") {
        return "/workspace/robots/barr-e/barr-e.project.yaml";
      }
      return "";
    });
    vi.stubGlobal("window", {
      robotick: {
        environment: {
          hubEndpoint: "http://127.0.0.1:44493",
        },
      },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/launcher/models/logs") {
        expect(url.origin).toBe("http://127.0.0.1:44493");
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
        expect(JSON.parse(String(init?.body))).toEqual({ project_id: "barr-e" });
        return createJsonResponse({
          resource_type: "robotick_launcher_model_logs_clear_result",
          project_id: "barr-e",
          cleared_models: [],
        });
      }
      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    expect(launcherInterface.getLauncherLogStreamUrl()).toBe(
      "ws://127.0.0.1:44493/v1/launcher/models/logs/stream?project_id=barr-e"
    );
    await expect(launcherInterface.fetchLauncherLogSnapshot(50)).resolves.toMatchObject({
      project_id: "barr-e",
      models: [],
    });
    await expect(launcherInterface.requestLauncherLogClear()).resolves.toBeUndefined();
  });

  it("prefers the current hub endpoint bridge over the startup environment endpoint", async () => {
    vi.mocked(readStorageValue).mockImplementation((key: string) =>
      key === "robotick-studio.projectPath"
        ? "/tmp/barr-e/barr-e.project.yaml"
        : ""
    );
    vi.stubGlobal("window", {
      robotick: {
        environment: {
          hubEndpoint: "http://127.0.0.1:37115",
        },
        hub: {
          getEndpoint: () => "http://127.0.0.1:53401",
        },
      },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/launcher/runtime") {
        expect(url.origin).toBe("http://127.0.0.1:53401");
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

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await expect(launcherInterface.fetchLauncherStatus()).resolves.toMatchObject({
      status: "running",
      models: {
        "barr-e-face": {
          status: "running",
          readiness: "ready",
        },
      },
    });
    expect(
      launcherInterface.buildProjectAssetUrl(
        "/tmp/demo/demo.project.yaml",
        "assets/demo.glb"
      )
    ).toContain("http://127.0.0.1:53401/query/project-assets/assets/demo.glb");
    await expect(launcherInterface.getLauncherLogStreamUrlAsync()).resolves.toBe(
      "ws://127.0.0.1:53401/v1/launcher/models/logs/stream?project_id=barr-e"
    );
  });
});
