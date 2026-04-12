import React, { act } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

const { useLauncherContextMock } = vi.hoisted(() => ({
  useLauncherContextMock: vi.fn(),
}));
const { useProjectDataMock } = vi.hoisted(() => ({
  useProjectDataMock: vi.fn(),
}));

vi.mock("../../../../renderer/data-sources/launcher", () => ({
  Launcher: {
    Context: {
      use: useLauncherContextMock,
    },
  },
  ProjectData: {
    use: useProjectDataMock,
  },
}));

import { Launcher } from "../../../../renderer/data-sources/launcher";
import type { LauncherStatus } from "../../../../renderer/data-sources/launcher";
import { LauncherControls } from "../../../../renderer/components/header/LauncherControls";

type LauncherContextValue = ReturnType<typeof Launcher.Context.use>;

const baseContextValue: LauncherContextValue = {
  status: "stopped",
  reportedStatus: "stopped",
  activeProfile: null,
  lastError: null,
  isBusy: false,
  isAwaitingStatus: false,
  isRobotAlive: true,
  robotAliveLoading: false,
  robotAliveError: null,
  launcherModels: {},
  modelHealth: {},
  run: vi.fn(),
  runProfile: vi.fn(),
  runModel: vi.fn(),
  stop: vi.fn(),
  stopModel: vi.fn(),
  restart: vi.fn(),
  restartProfile: vi.fn(),
  restartModel: vi.fn(),
};

function renderControl(): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(<LauncherControls />);
  });

  return {
    container,
    unmount: () =>
      act(() => {
        root.unmount();
      }),
  };
}

describe("LauncherControls", () => {
  it("shows the play button enabled when the launcher is stopped", () => {
    useProjectDataMock.mockReturnValue({
      projectModels: { data: [], loading: false, error: null },
    });
    useLauncherContextMock.mockReturnValue({
      ...baseContextValue,
      status: "stopped",
      reportedStatus: "stopped",
      lastError: "Previous run failed",
    });
    const { container, unmount } = renderControl();
    const buttons = container.querySelectorAll("button");
    expect(buttons[0]).not.toBeUndefined();
    expect(buttons[0].disabled).toBe(false);
    unmount();
  });

  it("keeps the stop button available while a run request is in-flight", () => {
    useProjectDataMock.mockReturnValue({
      projectModels: { data: [], loading: false, error: null },
    });
    useLauncherContextMock.mockReturnValue({
      ...baseContextValue,
      status: "launching" as LauncherStatus,
      reportedStatus: "launching",
      isBusy: true,
      isAwaitingStatus: true,
    });
    const { container, unmount } = renderControl();
    const buttons = container.querySelectorAll("button");
    expect(buttons[0]).not.toBeUndefined();
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[0].getAttribute("aria-label")).toBe("Stop launcher");
    expect(buttons[0].textContent).toContain("⏹");
    unmount();
  });

  it("keeps the stop button visible while restart is pending", () => {
    useProjectDataMock.mockReturnValue({
      projectModels: { data: [], loading: false, error: null },
    });
    useLauncherContextMock.mockReturnValue({
      ...baseContextValue,
      status: "launching" as LauncherStatus,
      reportedStatus: "stopped",
      isBusy: false,
      isAwaitingStatus: true,
    });
    const { container, unmount } = renderControl();
    const buttons = container.querySelectorAll("button");
    expect(buttons[0]).not.toBeUndefined();
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[0].getAttribute("aria-label")).toBe("Stop launcher");
    expect(buttons[0].textContent).toContain("⏹");
    unmount();
  });

  it("shows running and non-running models in the launcher tooltip", () => {
    useProjectDataMock.mockReturnValue({
      projectModels: { data: [], loading: false, error: null },
    });
    useLauncherContextMock.mockReturnValue({
      ...baseContextValue,
      status: "running" as LauncherStatus,
      reportedStatus: "running",
      launcherModels: {
        "alf-e-face": { stage: "run", status: "running" },
        "alf-e-spine": { stage: "run", status: "running" },
      },
      modelHealth: {
        "alf-e-face": { alive: true, loading: false, error: null },
        "alf-e-spine": {
          alive: false,
          loading: false,
          error: "flatlined",
        },
      },
    });
    const { container, unmount } = renderControl();

    expect(container.textContent).toContain("Launcher Models");
    expect(container.textContent).toContain("Running");
    expect(container.textContent).toContain("alf-e-face");
    expect(container.textContent).toContain("Not Running");
    expect(container.textContent).toContain("alf-e-spine");
    expect(container.textContent).toContain("flatlined");
    unmount();
  });

  it("treats successfully launched esp32-style models as running in the tooltip", () => {
    useProjectDataMock.mockReturnValue({
      projectModels: { data: [], loading: false, error: null },
    });
    useLauncherContextMock.mockReturnValue({
      ...baseContextValue,
      status: "running" as LauncherStatus,
      reportedStatus: "running",
      launcherModels: {
        "alf-e-spine": { stage: "run", status: "succeeded" },
      },
      modelHealth: {
        "alf-e-spine": { alive: true, loading: false, error: null },
      },
    });
    const { container, unmount } = renderControl();

    expect(container.textContent).toContain("Running");
    expect(container.textContent).toContain("alf-e-spine");
    expect(container.textContent).toContain("launched");
    expect(container.textContent).not.toContain("Not Running");
    unmount();
  });

  it("keeps detached launched models running when health is temporarily unavailable", () => {
    useProjectDataMock.mockReturnValue({
      projectModels: { data: [], loading: false, error: null },
    });
    useLauncherContextMock.mockReturnValue({
      ...baseContextValue,
      status: "running" as LauncherStatus,
      reportedStatus: "running",
      isRobotAlive: true,
      launcherModels: {
        "alf-e-spine": { stage: "run", status: "succeeded" },
      },
      modelHealth: {
        "alf-e-spine": {
          alive: true,
          loading: false,
          error: null,
          warning: "503 Service Unavailable",
        },
      },
    });
    const { container, unmount } = renderControl();

    expect(container.textContent).toContain("Running");
    expect(container.textContent).toContain("alf-e-spine");
    expect(container.textContent).toContain("launched");
    expect(container.textContent).toContain("health unavailable");
    expect(container.textContent).not.toContain("Not Running");
    unmount();
  });

  it("shows model rows even before launcher has ever reported model status", () => {
    useProjectDataMock.mockReturnValue({
      projectModels: {
        data: [
          {
            modelShortName: "barr-e-simulator",
            modelName: "Barr.e™ Simulator",
          },
        ],
        loading: false,
        error: null,
      },
    });
    useLauncherContextMock.mockReturnValue({
      ...baseContextValue,
      status: "stopped",
      reportedStatus: "stopped",
      launcherModels: {},
      modelHealth: {},
    });

    const { container, unmount } = renderControl();
    expect(container.textContent).toContain("Not Running");
    expect(container.textContent).toContain("barr-e-simulator");
    unmount();
  });

  it("runs a model-specific profile from a per-model row start button", async () => {
    const runModel = vi.fn().mockResolvedValue(undefined);
    useProjectDataMock.mockReturnValue({
      projectModels: {
        data: [
          {
            modelShortName: "barr-e-simulator",
            modelName: "Barr.e™ Simulator",
          },
        ],
        loading: false,
        error: null,
      },
    });
    useLauncherContextMock.mockReturnValue({
      ...baseContextValue,
      status: "stopped",
      reportedStatus: "stopped",
      runModel,
    });

    const { container, unmount } = renderControl();
    const button = container.querySelector(
      'button[aria-label="Start barr-e-simulator"]'
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(runModel).toHaveBeenCalledWith("barr-e-simulator");
    unmount();
  });

  it("stops only the selected model from a per-model row stop button", async () => {
    const stopModel = vi.fn().mockResolvedValue(undefined);
    useProjectDataMock.mockReturnValue({
      projectModels: {
        data: [
          {
            modelShortName: "barr-e-simulator",
            modelName: "Barr.e™ Simulator",
          },
          {
            modelShortName: "barr-e-spine",
            modelName: "Barr.e™ Spine",
          },
        ],
        loading: false,
        error: null,
      },
    });
    useLauncherContextMock.mockReturnValue({
      ...baseContextValue,
      status: "running",
      reportedStatus: "running",
      activeProfile: "local:barr-e-simulator",
      stopModel,
      launcherModels: {
        "barr-e-simulator": { stage: "run", status: "running" },
        "barr-e-spine": { stage: "run", status: "running" },
      },
      modelHealth: {
        "barr-e-simulator": { alive: true, loading: false, error: null },
        "barr-e-spine": { alive: true, loading: false, error: null },
      },
    });

    const { container, unmount } = renderControl();
    const button = container.querySelector(
      'button[aria-label="Stop barr-e-simulator"]'
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(stopModel).toHaveBeenCalledWith("barr-e-simulator");
    unmount();
  });

  afterEach(() => {
    useLauncherContextMock.mockReset();
    useProjectDataMock.mockReset();
  });
});
