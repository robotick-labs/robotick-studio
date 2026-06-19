import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElectronLauncherDataSource } from "../../../electron/main/data-sources/launcher/electron-launcher-data-source";
import { createElectronTelemetryService } from "../../../electron/main/data-sources/telemetry/electron-telemetry-service";
import type { LayoutModel } from "../../../electron/common/telemetry/telemetry-decoder";

vi.mock("../../../renderer/services/storage", () => ({
  readStorageValue: vi.fn((key: string) => {
    if (key === "robotick-studio.projectPath") {
      return "/workspace/robots/barr-e/barr-e.project.yaml";
    }
    if (key === "robotick-studio.launcherProfile") {
      return "native:ALL";
    }
    return "";
  }),
  setStorageValue: vi.fn(),
  removeStorageValue: vi.fn(),
}));

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const layout: LayoutModel = {
  engine_session_id: "session-bridge",
  workloads_buffer_size_used: 8,
  workloads: [],
  types: [],
};

describe("Electron data-source bridge contracts", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lets the renderer launcher client consume the main launcher data-source through a preload-shaped bridge", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/query/list-projects") {
        return jsonResponse(["/workspace/robots/barr-e/barr-e.project.yaml"]);
      }
      if (url.pathname === "/query/list-project-models") {
        expect(url.searchParams.get("project_path")).toBe(
          "/workspace/robots/barr-e/barr-e.project.yaml",
        );
        return jsonResponse(["models/barr-e-face.model.yaml"]);
      }
      if (url.pathname === "/query/get-model") {
        return jsonResponse({
          id: "barr-e-face",
          name: "Barr.e Face",
          telemetry: { port: 9030, telemetry_push_rate_hz: 30 },
        });
      }
      throw new Error(`Unexpected launcher fetch: ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const dataSource = createElectronLauncherDataSource({
      getWorkspaceRoot: () => "/workspace",
      getStaticHubEndpoint: () => "http://127.0.0.1:44493",
      getHubEndpoint: async () => "http://127.0.0.1:53401",
    });

    vi.stubGlobal("window", {
      robotick: {
        launcher: {
          listProjectPaths: () => dataSource.fetchProjectPaths(),
          getProjectSettings: (projectPath: string) =>
            dataSource.fetchProjectSettingsData(projectPath),
          getProjectRemoteControlSettings: (projectPath: string) =>
            dataSource.fetchProjectRemoteControlSettings(projectPath),
          listProjectModelPaths: (projectPath: string) =>
            dataSource.fetchProjectModelPaths(projectPath),
          getWorkloadsRegistry: (projectPath: string, target?: string) =>
            dataSource.fetchProjectWorkloadsRegistry(projectPath, target),
          getCoreModelSchema: (projectPath: string, target?: string) =>
            dataSource.fetchProjectCoreModelSchema(projectPath, target),
          getProjectModels: (
            projectPath: string,
            launcherProfile: string,
            options?: { force?: boolean },
          ) =>
            options?.force
              ? dataSource.refreshProjectModels(projectPath, launcherProfile)
              : dataSource.getProjectModels(projectPath, launcherProfile),
          clearProjectModelCache: (projectPath?: string, launcherProfile?: string) => {
            dataSource.clearProjectModelCache(projectPath, launcherProfile);
            return Promise.resolve({ accepted: true });
          },
          run: (projectPath: string, launcherProfile: string) =>
            dataSource.requestLauncherRun(projectPath, launcherProfile),
          runModel: (projectPath: string, platform: "local" | "native", modelId: string) =>
            dataSource.requestLauncherRunModel(projectPath, platform, modelId),
          stop: (projectPath: string) => dataSource.requestLauncherStop(projectPath),
          stopModel: (projectPath: string, platform: "local" | "native", modelId: string) =>
            dataSource.requestLauncherStopModel(projectPath, platform, modelId),
          restart: (projectPath: string, launcherProfile: string) =>
            dataSource.requestLauncherRestart(projectPath, launcherProfile),
          restartModel: (
            projectPath: string,
            platform: "local" | "native",
            modelId: string,
          ) => dataSource.requestLauncherRestartModel(projectPath, platform, modelId),
          getStatus: (projectPath: string, launcherProfile: string) =>
            dataSource.fetchLauncherStatus(projectPath, launcherProfile),
          getLogStreamUrl: (projectPath: string) =>
            dataSource.getLauncherLogStreamUrl(projectPath),
          getLogSnapshot: (projectPath: string, tail?: number) =>
            dataSource.fetchLauncherLogSnapshot(projectPath, tail),
          clearLogs: (projectPath: string) => dataSource.requestLauncherLogClear(projectPath),
          getDiagnostics: (projectPath: string, launcherProfile: string) =>
            dataSource.getDiagnostics(projectPath, launcherProfile),
        },
      },
    });

    const launcherInterface =
      await import("../../../renderer/data-sources/launcher/internal/launcher-interface");

    await expect(launcherInterface.fetchProjectPaths()).resolves.toEqual([
      "/workspace/robots/barr-e/barr-e.project.yaml",
    ]);
    await expect(
      launcherInterface.getProjectModels("/workspace/robots/barr-e/barr-e.project.yaml"),
    ).resolves.toMatchObject([
      {
        modelShortName: "barr-e-face",
        telemetryBaseUrl: "http://localhost:9030",
      },
    ]);
  });

  it("lets the renderer telemetry client consume the main telemetry service through a preload-shaped bridge", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://localhost:9030/api/telemetry/workloads_buffer/layout") {
        return new Response(JSON.stringify(layout), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected telemetry fetch: ${url}`);
    });
    const webSocketFactory = vi.fn(() => ({
      binaryType: "arraybuffer",
      readyState: 1,
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close: vi.fn(),
    }));
    const telemetryService = createElectronTelemetryService({
      getSelectedProjectPath: () => "/workspace/robots/barr-e/barr-e.project.yaml",
      getHubEndpoint: () => "http://127.0.0.1:53401",
      fetch: fetchMock as unknown as typeof fetch,
      webSocketFactory,
      now: () => new Date("2026-06-19T12:00:00.000Z"),
    });

    vi.stubGlobal("window", {
      robotick: {
        telemetry: {
          ensureLayout: (baseUrl: string) =>
            telemetryService.ensureLayoutForBaseUrl(baseUrl),
          refreshLayout: (baseUrl: string) =>
            telemetryService.refreshLayoutForBaseUrl(baseUrl),
          getDiagnostics: (baseUrl: string) =>
            Promise.resolve(telemetryService.getBaseUrlDiagnostics(baseUrl)),
          getSharedDiagnostics: () =>
            Promise.resolve(telemetryService.getSharedDiagnostics()),
          getHealth: (baseUrl: string) => telemetryService.getHealthForBaseUrl(baseUrl),
          getPushStats: (baseUrl: string) =>
            telemetryService.getPushStatsForBaseUrl(baseUrl),
          setWorkloadInputFieldsData: (baseUrl: string, request: never) =>
            telemetryService.setWorkloadInputFieldsDataForBaseUrl(baseUrl, request),
          setWorkloadInputConnectionState: (baseUrl: string, request: never) =>
            telemetryService.setWorkloadInputConnectionStateForBaseUrl(baseUrl, request),
          subscribe: (baseUrl: string, callback: never) =>
            telemetryService.subscribeBaseUrl(baseUrl, callback),
        },
      },
    });

    const telemetryClient =
      await import("../../../renderer/data-sources/telemetry/internal/telemetry-client");

    await expect(
      telemetryClient.fetchTelemetryLayout("http://localhost:9030"),
    ).resolves.toMatchObject({ engine_session_id: "session-bridge" });
    expect(telemetryService.getSharedDiagnostics()).toMatchObject({
      activeBaseUrlCount: 1,
      baseUrls: [
        {
          baseUrl: "http://localhost:9030",
          layoutLoaded: true,
        },
      ],
    });
  });
});
