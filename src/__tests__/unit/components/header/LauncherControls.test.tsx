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
    expect(buttons[1]?.getAttribute("aria-label")).toBe("Restart launcher");
    expect(buttons[1]?.disabled).toBe(true);
    expect(buttons[2]?.getAttribute("aria-label")).toBe(
      "Toggle launcher model menu"
    );
    expect(buttons[2]?.disabled).toBe(false);
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

  it("shows concise model state labels in the launcher tooltip", () => {
    useProjectDataMock.mockReturnValue({
      projectModels: { data: [], loading: false, error: null },
    });
    useLauncherContextMock.mockReturnValue({
      ...baseContextValue,
      status: "running" as LauncherStatus,
      reportedStatus: "running",
      launcherModels: {
        "sample-robot-face": { stage: "run", status: "running" },
        "sample-robot-spine": { stage: "run", status: "running" },
      },
      modelHealth: {
        "sample-robot-face": { alive: true, loading: false, error: null },
        "sample-robot-spine": {
          alive: false,
          loading: false,
          error: "flatlined",
        },
      },
    });
    const { container, unmount } = renderControl();

    expect(container.textContent).toContain("Launcher Models");
    expect(container.textContent).toContain("Running");
    expect(container.textContent).toContain("sample-robot-face");
    expect(container.textContent).toContain("sample-robot-spine");
    expect(container.textContent).toContain("running");
    expect(container.textContent).not.toContain("flatlined");
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
        "sample-robot-spine": { stage: "run", status: "succeeded" },
      },
      modelHealth: {
        "sample-robot-spine": { alive: true, loading: false, error: null },
      },
    });
    const { container, unmount } = renderControl();

    expect(container.textContent).toContain("Running");
    expect(container.textContent).toContain("sample-robot-spine");
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
        "sample-robot-spine": { stage: "run", status: "succeeded" },
      },
      modelHealth: {
        "sample-robot-spine": {
          alive: true,
          loading: false,
          error: null,
          warning: "503 Service Unavailable",
        },
      },
    });
    const { container, unmount } = renderControl();

    expect(container.textContent).toContain("Running");
    expect(container.textContent).toContain("sample-robot-spine");
    expect(container.textContent).toContain("launched");
    expect(container.textContent).not.toContain("Not Running");
    unmount();
  });

  it("treats stale models as degraded rather than running", () => {
    useProjectDataMock.mockReturnValue({
      projectModels: { data: [], loading: false, error: null },
    });
    useLauncherContextMock.mockReturnValue({
      ...baseContextValue,
      status: "running" as LauncherStatus,
      reportedStatus: "running",
      launcherModels: {
        "sample-robot-spine": {
          stage: "run",
          status: "running",
          lifecycle: "stale",
          freshness: "stale",
          diagnostics: [
            {
              code: "runtime_stale",
              message: "telemetry heartbeat expired",
            },
          ],
          logRefs: [
            {
              kind: "worker",
              path: "/tmp/sample-robot-spine.log",
            },
          ],
        },
      },
      modelHealth: {
        "sample-robot-spine": {
          alive: false,
          loading: false,
          error: "timed out",
        },
      },
    });
    const { container, unmount } = renderControl();

    expect(container.textContent).toContain("Not Running");
    expect(container.textContent).toContain("sample-robot-spine");
    expect(container.textContent).toContain("stale");
    expect(container.textContent).not.toContain("telemetry heartbeat expired");
    unmount();
  });

  it("keeps launcher identity and log detail out of the main tooltip rows", () => {
    useProjectDataMock.mockReturnValue({
      projectModels: { data: [], loading: false, error: null },
    });
    useLauncherContextMock.mockReturnValue({
      ...baseContextValue,
      status: "running" as LauncherStatus,
      reportedStatus: "running",
      launcherModels: {
        "sample-robot-face": {
          stage: "run",
          status: "running",
          readiness: "ready",
          groupId: "msg_face_pack",
          sessionId: "ms_face_v2",
          logRefs: [
            {
              kind: "worker",
              path: "/tmp/sample-robot-face.log",
            },
          ],
        },
      },
      modelHealth: {
        "sample-robot-face": {
          alive: true,
          loading: false,
          error: null,
        },
      },
    });

    const { container, unmount } = renderControl();

    expect(container.textContent).toContain("sample-robot-face");
    expect(container.textContent).toContain("running");
    expect(container.textContent).not.toContain("session ms_face_v2");
    expect(container.textContent).not.toContain("group msg_face_pack");
    expect(container.textContent).not.toContain("worker logs available");
    unmount();
  });

  it("shows model rows even before launcher has ever reported model status", () => {
    useProjectDataMock.mockReturnValue({
      projectModels: {
        data: [
          {
            modelShortName: "demo-robot-simulator",
            modelName: "DemoBot Simulator",
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
    expect(container.textContent).toContain("demo-robot-simulator");
    unmount();
  });

  it("runs a model-specific profile from a per-model row start button", async () => {
    const runModel = vi.fn().mockResolvedValue(undefined);
    useProjectDataMock.mockReturnValue({
      projectModels: {
        data: [
          {
            modelShortName: "demo-robot-simulator",
            modelName: "DemoBot Simulator",
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
      'button[aria-label="Start demo-robot-simulator"]'
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(runModel).toHaveBeenCalledWith("demo-robot-simulator");
    unmount();
  });

  it("stops only the selected model from a per-model row stop button", async () => {
    const stopModel = vi.fn().mockResolvedValue(undefined);
    useProjectDataMock.mockReturnValue({
      projectModels: {
        data: [
          {
            modelShortName: "demo-robot-simulator",
            modelName: "DemoBot Simulator",
          },
          {
            modelShortName: "demo-robot-spine",
            modelName: "DemoBot Spine",
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
      activeProfile: "local:demo-robot-simulator",
      stopModel,
      launcherModels: {
        "demo-robot-simulator": { stage: "run", status: "running" },
        "demo-robot-spine": { stage: "run", status: "running" },
      },
      modelHealth: {
        "demo-robot-simulator": { alive: true, loading: false, error: null },
        "demo-robot-spine": { alive: true, loading: false, error: null },
      },
    });

    const { container, unmount } = renderControl();
    const button = container.querySelector(
      'button[aria-label="Stop demo-robot-simulator"]'
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(stopModel).toHaveBeenCalledWith("demo-robot-simulator");
    unmount();
  });

  afterEach(() => {
    useLauncherContextMock.mockReset();
    useProjectDataMock.mockReset();
  });
});
