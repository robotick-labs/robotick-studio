import React, { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  Launcher,
  LauncherServiceProvider,
  Project,
  ProjectData,
  createMockLauncherService,
} from "../../../../renderer/data-sources/launcher";
import type { LauncherService } from "../../../../renderer/data-sources/launcher";
import { LauncherControls } from "../../../../renderer/components/header/LauncherControls";

function renderWithLauncherService(
  service: LauncherService,
  node: React.ReactElement
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <LauncherServiceProvider service={service}>{node}</LauncherServiceProvider>
    );
  });

  return {
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function ProjectConsumer({
  onValue,
}: {
  onValue: (value: ReturnType<typeof Project.Context.use>) => void;
}) {
  const ctx = Project.Context.use();
  useLayoutEffect(() => {
    onValue(ctx);
  }, [ctx, onValue]);
  return null;
}

function LauncherConsumer({
  onValue,
}: {
  onValue: (value: ReturnType<typeof Launcher.Context.use>) => void;
}) {
  const ctx = Launcher.Context.use();
  useLayoutEffect(() => {
    onValue(ctx);
  }, [ctx, onValue]);
  return null;
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe("Launcher service integration", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const demoModel = {
    modelPath: "models/demo-robot-face.model.yaml",
    modelShortName: "demo-robot-face",
    modelName: "Demo Robot Face",
    telemetryPort: 7090,
    telemetryBaseUrl: "http://localhost:7090/api/telemetry",
    telemetryPushRateHz: 20,
    data: {},
  };
  const demoSpineModel = {
    modelPath: "models/demo-robot-spine.model.yaml",
    modelShortName: "demo-robot-spine",
    modelName: "Demo Robot Spine",
    telemetryPort: 7091,
    telemetryBaseUrl: "http://localhost:7091/api/telemetry",
    telemetryPushRateHz: 20,
    data: {},
  };

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("injects the launcher service into the Project provider", () => {
    const setProjectPath = vi.fn();
    const service = createMockLauncherService({
      getProjectPath: () => "/mock/path",
      setProjectPath,
    });
    const capture = vi.fn();

    const { unmount } = renderWithLauncherService(
      service,
      <Project.Context.Provider>
        <ProjectConsumer onValue={capture} />
      </Project.Context.Provider>
    );

    expect(capture).toHaveBeenCalled();
    const ctx = capture.mock.calls.at(-1)?.[0];
    expect(ctx?.projectPath).toBe("/mock/path");

    act(() => {
      ctx?.setProjectPath("/new/path");
    });
    expect(setProjectPath).toHaveBeenCalledWith("/new/path");
    unmount();
  });

  it("routes launcher run requests and surfaces errors from the service", async () => {
    const runError = new Error("boom");
    const requestLauncherRun = vi.fn().mockRejectedValue(runError);
    const fetchLauncherStatus = vi
      .fn()
      .mockResolvedValue({ status: "stopped" });
    const service = createMockLauncherService({
      projectPath: "/proj",
      launcherProfile: "custom-profile",
      requestLauncherRun,
      fetchLauncherStatus,
    });

    const capture = vi.fn();
    const { unmount } = renderWithLauncherService(
      service,
      <Project.Context.Provider>
        <Launcher.Context.Provider>
          <LauncherConsumer onValue={capture} />
        </Launcher.Context.Provider>
      </Project.Context.Provider>
    );

    await flushPromises();
    const ctx = capture.mock.calls.at(-1)?.[0];
    expect(ctx).toBeDefined();

    let thrown: unknown;
    await act(async () => {
      try {
        await ctx.run();
      } catch (err) {
        thrown = err;
      }
    });

    expect(thrown).toBe(runError);
    expect(requestLauncherRun).toHaveBeenCalledWith("/proj", "custom-profile");

    await flushPromises();
    const latestCtx = capture.mock.calls.at(-1)?.[0];
    expect(latestCtx?.lastError).toBe("boom");
    unmount();
  });

  it("keeps the launcher control in stop mode while restart is in progress", async () => {
    vi.useFakeTimers();

    let currentStatus = "running";
    const requestLauncherRestart = vi.fn().mockImplementation(async () => {
      currentStatus = "stopping";
      setTimeout(() => {
        currentStatus = "launching";
      }, 200);
      setTimeout(() => {
        currentStatus = "running";
      }, 400);
    });
    const fetchLauncherStatus = vi.fn().mockImplementation(async () => ({
      status: currentStatus,
      phase:
        currentStatus === "running"
          ? "run"
          : currentStatus === "stopping"
            ? "stop"
            : null,
      models: {},
    }));

    const service = createMockLauncherService({
      projectPath: "/proj",
      getLauncherProfile: () => "local:ALL",
      requestLauncherRestart,
      fetchLauncherStatus,
    });

    const { unmount } = renderWithLauncherService(
      service,
      <Project.Context.Provider>
        <ProjectData.Provider>
          <Launcher.Context.Provider>
            <LauncherControls />
          </Launcher.Context.Provider>
        </ProjectData.Provider>
      </Project.Context.Provider>
    );

    await flushPromises();
    await advance(1000);

    let startStop = document.querySelector(
      'button[aria-label="Stop launcher"], button[aria-label="Start launcher"]'
    ) as HTMLButtonElement | null;
    const restart = document.querySelector(
      'button[aria-label="Restart launcher"]'
    ) as HTMLButtonElement | null;

    expect(startStop?.getAttribute("aria-label")).toBe("Stop launcher");
    expect(restart?.disabled).toBe(false);

    await act(async () => {
      restart?.click();
      await Promise.resolve();
    });

    startStop = document.querySelector(
      'button[aria-label="Stop launcher"], button[aria-label="Start launcher"]'
    ) as HTMLButtonElement | null;
    expect(startStop?.getAttribute("aria-label")).toBe("Stop launcher");
    expect(startStop?.disabled).toBe(false);
    expect(requestLauncherRestart).toHaveBeenCalledTimes(1);
    expect(requestLauncherRestart).toHaveBeenCalledWith("/proj", "local:ALL");

    await advance(250);
    startStop = document.querySelector(
      'button[aria-label="Stop launcher"], button[aria-label="Start launcher"]'
    ) as HTMLButtonElement | null;
    expect(startStop?.getAttribute("aria-label")).toBe("Stop launcher");

    await advance(1250);
    startStop = document.querySelector(
      'button[aria-label="Stop launcher"], button[aria-label="Start launcher"]'
    ) as HTMLButtonElement | null;
    expect(startStop?.getAttribute("aria-label")).toBe("Stop launcher");

    vi.useRealTimers();
    unmount();
  });

  it("shows an immediate launching state for a per-model start request", async () => {
    vi.useFakeTimers();

    let currentStatus = "stopped";
    let currentModels: Record<string, Record<string, string>> = {};
    const requestLauncherRunModel = vi.fn().mockImplementation(async () => {
      setTimeout(() => {
        currentStatus = "running";
        currentModels = {
          "demo-robot-face": {
            stage: "run",
            status: "running",
            lifecycle: "running",
            readiness: "ready",
            freshness: "live",
          },
        };
      }, 700);
    });
    const fetchLauncherStatus = vi.fn().mockImplementation(async () => ({
      status: currentStatus,
      phase: currentStatus === "running" ? "run" : null,
      models: currentModels,
    }));

    const service = createMockLauncherService({
      projectPath: "/proj",
      getLauncherProfile: () => "local:ALL",
      getProjectModels: async () => [demoModel],
      refreshProjectModels: async () => [demoModel],
      requestLauncherRunModel,
      fetchLauncherStatus,
    });

    const { unmount } = renderWithLauncherService(
      service,
      <Project.Context.Provider>
        <ProjectData.Provider>
          <Launcher.Context.Provider>
            <LauncherControls />
          </Launcher.Context.Provider>
        </ProjectData.Provider>
      </Project.Context.Provider>
    );

    await flushPromises();
    await advance(1000);

    const startButton = document.querySelector(
      'button[aria-label="Start demo-robot-face"]'
    ) as HTMLButtonElement | null;
    expect(startButton).not.toBeNull();

    await act(async () => {
      startButton?.click();
      await Promise.resolve();
    });

    expect(requestLauncherRunModel).toHaveBeenCalledWith("/proj", "local", "demo-robot-face");
    expect(document.body.textContent).toContain("launching");

    const stopButton = document.querySelector(
      'button[aria-label="Stop demo-robot-face"]'
    ) as HTMLButtonElement | null;
    expect(stopButton).not.toBeNull();
    expect(stopButton?.disabled).toBe(true);

    await advance(1000);
    expect(document.body.textContent).not.toContain("launching");

    vi.useRealTimers();
    unmount();
  });

  it("shows an immediate stopping state for a per-model stop request", async () => {
    vi.useFakeTimers();

    let currentStatus = "running";
    let currentModels: Record<string, Record<string, string>> = {
      "demo-robot-face": {
        stage: "run",
        status: "running",
        lifecycle: "running",
        readiness: "ready",
        freshness: "live",
      },
    };
    const requestLauncherStopModel = vi.fn().mockImplementation(async () => {
      setTimeout(() => {
        currentStatus = "stopped";
        currentModels = {
          "demo-robot-face": {
            stage: "stop",
            status: "succeeded",
            lifecycle: "stopped",
            readiness: "pending",
            freshness: "pending",
          },
        };
      }, 700);
    });
    const fetchLauncherStatus = vi.fn().mockImplementation(async () => ({
      status: currentStatus,
      phase: currentStatus === "running" ? "run" : null,
      models: currentModels,
    }));

    const service = createMockLauncherService({
      projectPath: "/proj",
      getLauncherProfile: () => "local:ALL",
      getProjectModels: async () => [demoModel],
      refreshProjectModels: async () => [demoModel],
      requestLauncherStopModel,
      fetchLauncherStatus,
    });

    const { unmount } = renderWithLauncherService(
      service,
      <Project.Context.Provider>
        <ProjectData.Provider>
          <Launcher.Context.Provider>
            <LauncherControls />
          </Launcher.Context.Provider>
        </ProjectData.Provider>
      </Project.Context.Provider>
    );

    await flushPromises();
    await advance(1000);

    const stopButton = document.querySelector(
      'button[aria-label="Stop demo-robot-face"]'
    ) as HTMLButtonElement | null;
    expect(stopButton).not.toBeNull();

    await act(async () => {
      stopButton?.click();
      await Promise.resolve();
    });

    expect(requestLauncherStopModel).toHaveBeenCalledWith("/proj", "local", "demo-robot-face");
    expect(document.body.textContent).toContain("stopping");

    const stoppingButton = document.querySelector(
      'button[aria-label="Stop demo-robot-face"]'
    ) as HTMLButtonElement | null;
    expect(stoppingButton?.disabled).toBe(true);

    await advance(1000);
    expect(document.body.textContent).toContain("stopped");

    vi.useRealTimers();
    unmount();
  });

  it("shows immediate stopping state for aggregate stop requests", async () => {
    vi.useFakeTimers();

    let currentStatus = "running";
    let currentModels: Record<string, Record<string, string>> = {
      "demo-robot-face": {
        stage: "run",
        status: "running",
        lifecycle: "running",
        readiness: "ready",
        freshness: "live",
      },
      "demo-robot-spine": {
        stage: "run",
        status: "running",
        lifecycle: "running",
        readiness: "ready",
        freshness: "live",
      },
    };
    const requestLauncherStop = vi.fn().mockImplementation(async () => {
      setTimeout(() => {
        currentStatus = "stopped";
        currentModels = {
          "demo-robot-face": {
            stage: "stop",
            status: "succeeded",
            lifecycle: "stopped",
            readiness: "pending",
            freshness: "pending",
          },
          "demo-robot-spine": {
            stage: "stop",
            status: "succeeded",
            lifecycle: "stopped",
            readiness: "pending",
            freshness: "pending",
          },
        };
      }, 700);
    });
    const fetchLauncherStatus = vi.fn().mockImplementation(async () => ({
      status: currentStatus,
      phase: currentStatus === "running" ? "run" : null,
      models: currentModels,
    }));

    const service = createMockLauncherService({
      projectPath: "/proj",
      getLauncherProfile: () => "local:ALL",
      getProjectModels: async () => [demoModel, demoSpineModel],
      refreshProjectModels: async () => [demoModel, demoSpineModel],
      requestLauncherStop,
      fetchLauncherStatus,
    });

    const { unmount } = renderWithLauncherService(
      service,
      <Project.Context.Provider>
        <ProjectData.Provider>
          <Launcher.Context.Provider>
            <LauncherControls />
          </Launcher.Context.Provider>
        </ProjectData.Provider>
      </Project.Context.Provider>
    );

    await flushPromises();
    await advance(1000);

    const aggregateStopButton = document.querySelector(
      'button[aria-label="Stop launcher"]'
    ) as HTMLButtonElement | null;
    expect(aggregateStopButton).not.toBeNull();

    await act(async () => {
      aggregateStopButton?.click();
      await Promise.resolve();
    });

    expect(requestLauncherStop).toHaveBeenCalled();
    expect(document.body.textContent).toContain("stopping");
    expect(document.body.textContent).not.toContain("running");
    expect(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Stop demo-robot-face"]'
      )?.disabled
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Stop demo-robot-spine"]'
      )?.disabled
    ).toBe(true);

    await advance(1000);
    expect(document.body.textContent).toContain("stopped");

    vi.useRealTimers();
    unmount();
  });

  it("restarts one model without globally blocking other model controls", async () => {
    vi.useFakeTimers();

    let currentStatus = "running";
    let currentModels: Record<string, Record<string, string>> = {
      "demo-robot-face": {
        stage: "run",
        status: "running",
        lifecycle: "running",
        readiness: "ready",
        freshness: "live",
      },
      "demo-robot-spine": {
        stage: "run",
        status: "running",
        lifecycle: "running",
        readiness: "ready",
        freshness: "live",
      },
    };
    const requestLauncherRestartModel = vi.fn().mockImplementation(async () => {
      currentModels = {
        ...currentModels,
        "demo-robot-face": {
          stage: "stop",
          status: "stopping",
          lifecycle: "stopping",
          readiness: "pending",
          freshness: "pending",
        },
      };
      setTimeout(() => {
        currentModels = {
          ...currentModels,
          "demo-robot-face": {
            stage: "run",
            status: "starting",
            lifecycle: "starting",
            readiness: "pending",
            freshness: "pending",
          },
        };
      }, 400);
      setTimeout(() => {
        currentModels = {
          ...currentModels,
          "demo-robot-face": {
            stage: "run",
            status: "running",
            lifecycle: "running",
            readiness: "ready",
            freshness: "live",
          },
        };
      }, 700);
    });
    const fetchLauncherStatus = vi.fn().mockImplementation(async () => ({
      status: currentStatus,
      phase: currentStatus === "running" ? "run" : null,
      models: currentModels,
    }));

    const service = createMockLauncherService({
      projectPath: "/proj",
      getLauncherProfile: () => "local:ALL",
      getProjectModels: async () => [demoModel, demoSpineModel],
      refreshProjectModels: async () => [demoModel, demoSpineModel],
      requestLauncherRestartModel,
      fetchLauncherStatus,
    });

    const { unmount } = renderWithLauncherService(
      service,
      <Project.Context.Provider>
        <ProjectData.Provider>
          <Launcher.Context.Provider>
            <LauncherControls />
          </Launcher.Context.Provider>
        </ProjectData.Provider>
      </Project.Context.Provider>
    );

    await flushPromises();
    await advance(1000);

    const restartButton = document.querySelector(
      'button[aria-label="Restart demo-robot-face"]'
    ) as HTMLButtonElement | null;
    expect(restartButton).not.toBeNull();

    await act(async () => {
      restartButton?.click();
      await Promise.resolve();
    });

    expect(requestLauncherRestartModel).toHaveBeenCalledWith(
      "/proj",
      "local",
      "demo-robot-face"
    );
    expect(document.body.textContent).toContain("stopping");

    const faceStopButton = document.querySelector(
      'button[aria-label="Stop demo-robot-face"]'
    ) as HTMLButtonElement | null;
    expect(faceStopButton?.disabled).toBe(true);

    const spineStopButton = document.querySelector(
      'button[aria-label="Stop demo-robot-spine"]'
    ) as HTMLButtonElement | null;
    expect(spineStopButton?.disabled).toBe(false);

    await advance(1000);
    expect(document.body.textContent).not.toContain("stopping");

    vi.useRealTimers();
    unmount();
  });

  it("reflects a launcher-reported stopped gap during restart polling", async () => {
    vi.useFakeTimers();

    let currentStatus = "running";
    const requestLauncherRestart = vi.fn().mockImplementation(async () => {
      currentStatus = "stopping";
      setTimeout(() => {
        currentStatus = "stopped";
      }, 50);
      setTimeout(() => {
        currentStatus = "launching";
      }, 1400);
      setTimeout(() => {
        currentStatus = "running";
      }, 1600);
    });
    const fetchLauncherStatus = vi.fn().mockImplementation(async () => ({
      status: currentStatus,
      phase:
        currentStatus === "running"
          ? "run"
          : currentStatus === "stopping"
            ? "stop"
            : currentStatus === "launching"
              ? "run"
              : null,
      models: {},
    }));

    const service = createMockLauncherService({
      projectPath: "/proj",
      getLauncherProfile: () => "local:ALL",
      requestLauncherRestart,
      fetchLauncherStatus,
    });

    const { unmount } = renderWithLauncherService(
      service,
      <Project.Context.Provider>
        <ProjectData.Provider>
          <Launcher.Context.Provider>
            <LauncherControls />
          </Launcher.Context.Provider>
        </ProjectData.Provider>
      </Project.Context.Provider>
    );

    await flushPromises();
    await advance(1000);

    const restart = document.querySelector(
      'button[aria-label="Restart launcher"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      restart?.click();
      await Promise.resolve();
    });

    expect(requestLauncherRestart).toHaveBeenCalledWith("/proj", "local:ALL");

    await advance(1100);
    let startStop = document.querySelector(
      'button[aria-label="Stop launcher"], button[aria-label="Start launcher"]'
    ) as HTMLButtonElement | null;
    expect(startStop?.getAttribute("aria-label")).toBe("Start launcher");

    await advance(500);
    startStop = document.querySelector(
      'button[aria-label="Stop launcher"], button[aria-label="Start launcher"]'
    ) as HTMLButtonElement | null;
    expect(startStop?.getAttribute("aria-label")).toBe("Stop launcher");

    await advance(1000);
    startStop = document.querySelector(
      'button[aria-label="Stop launcher"], button[aria-label="Start launcher"]'
    ) as HTMLButtonElement | null;
    expect(startStop?.getAttribute("aria-label")).toBe("Stop launcher");

    vi.useRealTimers();
    unmount();
  });
});
