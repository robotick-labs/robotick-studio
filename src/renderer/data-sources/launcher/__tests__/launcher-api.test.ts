import { describe, expect, it, vi } from "vitest";

const runMock = vi.fn();
const stopMock = vi.fn();
const statusMock = vi.fn();
const logsUrlMock = vi.fn(() => "ws://logs");
const listPathsMock = vi.fn();
const listDescriptorsMock = vi.fn();

vi.mock("../internal/rest-api", () => ({
  LauncherRest: {
    run: runMock,
    stop: stopMock,
    status: statusMock,
    logsStreamUrl: logsUrlMock,
  },
  ProjectRest: {
    listPaths: listPathsMock,
    settings: {
      get: vi.fn(),
      list: vi.fn(),
      raw: vi.fn(),
    },
    remoteControl: {
      getSettings: vi.fn(),
    },
    models: {
      listPaths: vi.fn(),
      listDescriptors: listDescriptorsMock,
    },
  },
}));

vi.mock("../internal/react-api", () => ({
  LauncherReact: {
    Provider: vi.fn(),
    use: vi.fn(),
    events: new EventTarget(),
  },
  ProjectReact: {
    Provider: vi.fn(),
    use: vi.fn(),
  },
  ProjectDataReact: {
    Provider: vi.fn(),
    use: vi.fn(),
    waitForProjectModelsLoaded: vi.fn(),
    waitForModelDescriptorByName: vi.fn(),
    findModelDescriptorInState: vi.fn(),
    getProjectModelsStateSnapshot: vi.fn(),
  },
  ProjectReactHooks: {
    useSettingsList: vi.fn(),
    useModels: vi.fn(),
    useChangeConfirmation: vi.fn(),
  },
}));

const launcherServiceMock = { marker: "launcher-service" };

vi.mock("../internal/LauncherService", () => ({
  LauncherServiceProvider: vi.fn(),
  useLauncherService: vi.fn(),
  createLauncherService: vi.fn(),
  launcherService: launcherServiceMock,
}));

const launcherModule = await import("..");

describe("launcher index public surface", () => {
  it("routes launcher service calls through rest helpers", async () => {
    await launcherModule.Launcher.Service.run("path", "profile");
    expect(runMock).toHaveBeenCalledWith("path", "profile");

    await launcherModule.Launcher.Service.stop();
    expect(stopMock).toHaveBeenCalled();

    await launcherModule.Launcher.Service.status();
    expect(statusMock).toHaveBeenCalled();

    expect(launcherModule.Launcher.Service.logs.streamUrl()).toBe(
      "ws://logs"
    );
    expect(logsUrlMock).toHaveBeenCalled();
  });

  it("exposes project helpers via rest module", async () => {
    await launcherModule.Project.Service.listPaths();
    expect(listPathsMock).toHaveBeenCalled();

    await launcherModule.Project.Service.models.listDescriptors("path");
    expect(listDescriptorsMock).toHaveBeenCalledWith("path");
  });

  it("exposes the shared launcher service for legacy access", () => {
    expect(launcherModule.Project.Service.current).toBe(
      launcherServiceMock
    );
  });
});
