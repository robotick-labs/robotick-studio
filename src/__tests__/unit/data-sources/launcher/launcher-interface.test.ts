import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readStorageValue,
  setStorageValue,
} from "../../../../renderer/services/storage";

vi.mock("../../../../renderer/services/storage", () => ({
  readStorageValue: vi.fn(() => ""),
  setStorageValue: vi.fn(),
  removeStorageValue: vi.fn(),
}));

function createLauncherBridge() {
  return {
    listProjectPaths: vi.fn(async () => []),
    getProjectSettings: vi.fn(async () => ({})),
    getProjectRemoteControlSettings: vi.fn(async () => ({})),
    listProjectModelPaths: vi.fn(async () => []),
    getWorkloadsRegistry: vi.fn(async () => ({ project: "", target: "linux" })),
    getCoreModelSchema: vi.fn(async () => ({})),
    getProjectModels: vi.fn(async () => []),
    clearProjectModelCache: vi.fn(async () => ({ accepted: true })),
    run: vi.fn(async () => undefined),
    runModel: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    stopModel: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    restartModel: vi.fn(async () => undefined),
    getStatus: vi.fn(async () => null),
    getLogStreamUrl: vi.fn(async () => ""),
    getLogSnapshot: vi.fn(async () => null),
    clearLogs: vi.fn(async () => undefined),
    getDiagnostics: vi.fn(async () => ({
      current_project_path: "/workspace/robots/sample/sample.project.yaml",
      launcher_profile: "native:ALL",
      static_hub_endpoint: "http://127.0.0.1:44493",
      cached_hub_endpoint: "http://127.0.0.1:53401",
      launcher_api_base: "http://127.0.0.1:53401",
      terminal_log_stream_url:
        "ws://127.0.0.1:53401/v1/launcher/models/logs/stream?project_id=sample",
      last_runtime_fetch_at: "2026-06-19T12:00:00.000Z",
      last_runtime_fetch_error: null,
    })),
  };
}

describe("launcher-interface bridge facade", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(readStorageValue).mockImplementation((key: string) => {
      if (key === "robotick-studio.projectPath") {
        return "/workspace/robots/sample/sample.project.yaml";
      }
      if (key === "robotick-studio.launcherProfile") {
        return "native:ALL";
      }
      return "";
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("builds routed telemetry urls without duplicating the api prefix", async () => {
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

  it("delegates project path discovery to the Electron launcher bridge", async () => {
    const launcher = createLauncherBridge();
    launcher.listProjectPaths.mockResolvedValue([
      "robots/zeta/zeta.project.yaml",
      "robots/alpha/alpha.project.yaml",
    ]);
    vi.stubGlobal("window", {
      robotick: {
        launcher,
      },
    });

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await expect(launcherInterface.fetchProjectPaths()).resolves.toEqual([
      "robots/alpha/alpha.project.yaml",
      "robots/zeta/zeta.project.yaml",
    ]);
  });

  it("delegates model descriptor loading with current launcher profile and force flag", async () => {
    const launcher = createLauncherBridge();
    launcher.getProjectModels.mockResolvedValue([{ modelPath: "m", modelShortName: "m" }]);
    vi.stubGlobal("window", {
      robotick: {
        launcher,
      },
    });

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await launcherInterface.getProjectModels("/tmp/sample");
    await launcherInterface.refreshProjectModels("/tmp/sample");

    expect(launcher.getProjectModels).toHaveBeenNthCalledWith(1, "/tmp/sample", "native:ALL", {
      force: false,
    });
    expect(launcher.getProjectModels).toHaveBeenNthCalledWith(2, "/tmp/sample", "native:ALL", {
      force: true,
    });
  });

  it("clears Electron-side model cache when launcher profile changes", async () => {
    const launcher = createLauncherBridge();
    vi.stubGlobal("window", {
      robotick: {
        launcher,
      },
    });

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    launcherInterface.default.setLauncherProfile("local:ALL");

    expect(setStorageValue).toHaveBeenCalledWith(
      "robotick-studio.launcherProfile",
      "local:ALL",
    );
    expect(launcher.clearProjectModelCache).toHaveBeenCalledWith(
      undefined,
      "native:ALL",
    );
  });

  it("delegates launcher control requests to the Electron bridge", async () => {
    const launcher = createLauncherBridge();
    vi.stubGlobal("window", {
      robotick: {
        launcher,
      },
    });

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await launcherInterface.requestLauncherRun("/tmp/sample.project.yaml", "native:ALL");
    await launcherInterface.requestLauncherStop();
    await launcherInterface.requestLauncherRestart("/tmp/sample.project.yaml", "native:ALL");

    expect(launcher.run).toHaveBeenCalledWith("/tmp/sample.project.yaml", "native:ALL");
    expect(launcher.stop).toHaveBeenCalledWith(
      "/workspace/robots/sample/sample.project.yaml"
    );
    expect(launcher.restart).toHaveBeenCalledWith("/tmp/sample.project.yaml", "native:ALL");
  });

  it("delegates runtime status and diagnostics to the Electron bridge", async () => {
    const launcher = createLauncherBridge();
    launcher.getStatus.mockResolvedValue({
      status: "running",
      profile: "native:ALL",
      models: {
        sample: {
          status: "running",
        },
      },
    });
    vi.stubGlobal("window", {
      robotick: {
        launcher,
      },
    });

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await expect(launcherInterface.fetchLauncherStatus()).resolves.toMatchObject({
      status: "running",
    });
    await expect(launcherInterface.getLauncherRendererDiagnosticsSnapshot()).resolves.toMatchObject({
      current_project_path: "/workspace/robots/sample/sample.project.yaml",
      launcher_api_base: "http://127.0.0.1:53401",
    });
  });

  it("delegates log snapshot and clear operations to the Electron bridge", async () => {
    const launcher = createLauncherBridge();
    launcher.getLogSnapshot.mockResolvedValue({
      resource_type: "robotick_launcher_model_logs_batch",
      project_id: "sample",
      models: [],
    });
    vi.stubGlobal("window", {
      robotick: {
        launcher,
      },
    });

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await expect(launcherInterface.fetchLauncherLogSnapshot(50)).resolves.toMatchObject({
      project_id: "sample",
      models: [],
    });
    await launcherInterface.requestLauncherLogClear();

    expect(launcher.getLogSnapshot).toHaveBeenCalledWith(
      "/workspace/robots/sample/sample.project.yaml",
      50,
    );
    expect(launcher.clearLogs).toHaveBeenCalledWith(
      "/workspace/robots/sample/sample.project.yaml",
    );
  });

  it("uses current hub endpoint state for asset urls and synchronous log stream urls", async () => {
    const launcher = createLauncherBridge();
    launcher.listProjectPaths.mockResolvedValue(["robots/demo/demo.project.yaml"]);
    vi.stubGlobal("window", {
      robotick: {
        launcher,
        environment: {
          hubEndpoint: "http://127.0.0.1:44493",
          workspaceRoot: "/workspace",
        },
        hub: {
          getEndpoint: async () => "http://127.0.0.1:53401",
        },
      },
    });

    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await launcherInterface.fetchProjectPaths();
    await launcherInterface.getLauncherLogStreamUrlAsync().catch(() => undefined);

    expect(
      launcherInterface.buildProjectAssetUrl(
        "demo.project.yaml",
        "assets/demo.glb",
      ),
    ).toContain("http://127.0.0.1:44493/query/project-assets/assets/demo.glb");
    expect(launcherInterface.getLauncherLogStreamUrl()).toBe(
      "ws://127.0.0.1:44493/v1/launcher/models/logs/stream?project_id=sample"
    );
  });

  it("throws when launcher bridge is unavailable", async () => {
    vi.stubGlobal("window", {
      robotick: {},
    });
    const launcherInterface =
      await import("../../../../renderer/data-sources/launcher/internal/launcher-interface");

    await expect(launcherInterface.fetchProjectPaths()).rejects.toThrow(
      "Launcher bridge unavailable",
    );
  });
});
