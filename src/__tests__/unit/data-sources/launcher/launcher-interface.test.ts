import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readStorageValue,
  setStorageValue,
} from "../../../../renderer/services/storage";

vi.mock(
  "../../../../renderer/services/storage",
  () => ({
    readStorageValue: vi.fn(() => ""),
    setStorageValue: vi.fn(),
  })
);

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
  options: { isGateway?: boolean } = {}
) {
  return {
    name,
    telemetry: {
      port,
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
        expect(projectPath).toBe("/tmp/alf-e");
        return createJsonResponse([
          "models/alf-e-rc.model.yaml",
          "models/alf-e-face.model.yaml",
          "models/alf-e-spine.model.yaml",
        ]);
      }

      if (path === "/query/get-model" && modelPath === "models/alf-e-rc.model.yaml") {
        return createJsonResponse(
          createModel("Alf.e RC", 7102, "192.168.5.16", { isGateway: true })
        );
      }

      if (path === "/query/get-model" && modelPath === "models/alf-e-face.model.yaml") {
        return createJsonResponse(createModel("Alf.e Face", 7103, "192.168.5.16"));
      }

      if (path === "/query/get-model" && modelPath === "models/alf-e-spine.model.yaml") {
        return createJsonResponse(createModel("Alf.e Spine", 7104, "10.42.0.2"));
      }

      if (path === "/api/telemetry-gateway/models") {
        expect(url.origin).toBe("http://192.168.5.16:7102");
        return createJsonResponse({
          gateway_model_id: "alf-e-rc",
          models: [
            {
              model_id: "alf-e-rc",
              telemetry_path: "/api/telemetry-gateway/alf-e-rc",
            },
            {
              model_id: "alf-e-face",
              telemetry_path: "/api/telemetry-gateway/alf-e-face",
            },
            {
              model_id: "alf-e-spine",
              telemetry_path: "/api/telemetry-gateway/alf-e-spine",
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

      const launcherInterface = await import(
      "../../../../renderer/data-sources/launcher/internal/launcher-interface"
    );

    const models = await launcherInterface.refreshProjectModels("/tmp/alf-e");
    const byName = new Map(models.map((model) => [model.modelShortName, model]));

    expect(byName.get("alf-e-rc")?.telemetryBaseUrl).toBe(
      "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-rc"
    );
    expect(byName.get("alf-e-face")?.telemetryBaseUrl).toBe(
      "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-face"
    );
    expect(byName.get("alf-e-spine")?.telemetryBaseUrl).toBe(
      "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-spine"
    );
  });

  it("falls back to synthesized gateway telemetry urls when the gateway registry is unavailable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const modelPath = url.searchParams.get("model_path");

      if (path === "/query/list-project-models") {
        return createJsonResponse([
          "models/alf-e-rc.model.yaml",
          "models/alf-e-face.model.yaml",
          "models/alf-e-spine.model.yaml",
        ]);
      }

      if (path === "/query/get-model" && modelPath === "models/alf-e-rc.model.yaml") {
        return createJsonResponse(
          createModel("Alf.e RC", 7102, "192.168.5.16", { isGateway: true })
        );
      }

      if (path === "/query/get-model" && modelPath === "models/alf-e-face.model.yaml") {
        return createJsonResponse(createModel("Alf.e Face", 7103, "192.168.5.16"));
      }

      if (path === "/query/get-model" && modelPath === "models/alf-e-spine.model.yaml") {
        return createJsonResponse(createModel("Alf.e Spine", 7104, "10.42.0.2"));
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

      const launcherInterface = await import(
      "../../../../renderer/data-sources/launcher/internal/launcher-interface"
    );

    const models = await launcherInterface.refreshProjectModels("/tmp/alf-e");
    const byName = new Map(models.map((model) => [model.modelShortName, model]));

    expect(byName.get("alf-e-rc")?.telemetryBaseUrl).toBe(
      "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-rc"
    );
    expect(byName.get("alf-e-face")?.telemetryBaseUrl).toBe(
      "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-face"
    );
    expect(byName.get("alf-e-spine")?.telemetryBaseUrl).toBe(
      "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-spine"
    );
  });

  it("keeps all model telemetry local when the active launcher profile is local", async () => {
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
          "models/alf-e-rc.model.yaml",
          "models/alf-e-face.model.yaml",
          "models/alf-e-spine.model.yaml",
        ]);
      }

      if (path === "/query/get-model" && modelPath === "models/alf-e-rc.model.yaml") {
        return createJsonResponse(
          createModel("Alf.e RC", 7102, "192.168.5.16", { isGateway: true })
        );
      }

      if (path === "/query/get-model" && modelPath === "models/alf-e-face.model.yaml") {
        return createJsonResponse(createModel("Alf.e Face", 7103, "192.168.5.16"));
      }

      if (path === "/query/get-model" && modelPath === "models/alf-e-spine.model.yaml") {
        return createJsonResponse(createModel("Alf.e Spine", 7104, "10.42.0.2"));
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const launcherInterface = await import(
      "../../../../renderer/data-sources/launcher/internal/launcher-interface"
    );

    const models = await launcherInterface.refreshProjectModels("/tmp/alf-e");
    const byName = new Map(models.map((model) => [model.modelShortName, model]));

    expect(byName.get("alf-e-rc")?.telemetryBaseUrl).toBe(
      "http://localhost:7102"
    );
    expect(byName.get("alf-e-face")?.telemetryBaseUrl).toBe(
      "http://localhost:7103"
    );
    expect(byName.get("alf-e-spine")?.telemetryBaseUrl).toBe(
      "http://localhost:7104"
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/telemetry-gateway/models")
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
          "models/alf-e-rc.model.yaml",
          "models/alf-e-spine.model.yaml",
        ]);
      }

      if (path === "/query/get-model" && modelPath === "models/alf-e-rc.model.yaml") {
        return createJsonResponse(
          createModel("Alf.e RC", 7102, "192.168.5.16", { isGateway: true })
        );
      }

      if (path === "/query/get-model" && modelPath === "models/alf-e-spine.model.yaml") {
        return createJsonResponse(createModel("Alf.e Spine", 7104, "10.42.0.2"));
      }

      if (path === "/api/telemetry-gateway/models") {
        return createJsonResponse({
          gateway_model_id: "alf-e-rc",
          models: [
            {
              model_id: "alf-e-rc",
              telemetry_path: "/api/telemetry-gateway/alf-e-rc",
            },
            {
              model_id: "alf-e-spine",
              telemetry_path: "/api/telemetry-gateway/alf-e-spine",
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const launcherInterface = await import(
      "../../../../renderer/data-sources/launcher/internal/launcher-interface"
    );

    const nativeModels = await launcherInterface.getProjectModels("/tmp/alf-e");
    expect(nativeModels.find((model) => model.modelShortName === "alf-e-spine")?.telemetryBaseUrl).toBe(
      "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-spine"
    );

    launcherProfile = "local:ALL";
    launcherInterface.default.setLauncherProfile("local:ALL");

    const localModels = await launcherInterface.getProjectModels("/tmp/alf-e");
    expect(localModels.find((model) => model.modelShortName === "alf-e-spine")?.telemetryBaseUrl).toBe(
      "http://localhost:7104"
    );
    expect(setStorageValue).toHaveBeenCalledWith(
      "robotick-studio.launcherProfile",
      "local:ALL"
    );
  });

  it("joins routed telemetry urls without duplicating the api prefix", async () => {
    const launcherInterface = await import(
      "../../../../renderer/data-sources/launcher/internal/launcher-interface"
    );

    expect(
      launcherInterface.buildUrl(
        "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-face",
        "/api/telemetry/workloads_buffer/layout"
      )
    ).toBe(
      "http://192.168.5.16:7102/api/telemetry-gateway/alf-e-face/workloads_buffer/layout"
    );
  });

  it("resolves stored project basenames to absolute project paths before run requests", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));

      if (url.pathname === "/query/list-projects") {
        return createJsonResponse(["robots/alf-e/alf-e.project.yaml"]);
      }

      if (url.pathname === "/launcher/run") {
        expect(init?.method).toBe("POST");
        expect(url.searchParams.get("project_path")).toBe(
          "/workspace/robots/alf-e/alf-e.project.yaml"
        );
        expect(url.searchParams.get("profile")).toBe("native:ALL");
        return createJsonResponse({ status: "launching" });
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    window.robotick = {
      environment: {
        isStandaloneApp: true,
        appTitle: "Robotick Studio",
        workspaceRoot: "/workspace",
      },
    };

    const launcherInterface = await import(
      "../../../../renderer/data-sources/launcher/internal/launcher-interface"
    );

    await launcherInterface.requestLauncherRun("alf-e.project.yaml", "native:ALL");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
