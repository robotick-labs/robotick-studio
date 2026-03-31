import React, { act } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

const { useLauncherContextMock } = vi.hoisted(() => ({
  useLauncherContextMock: vi.fn(),
}));

vi.mock("../../../../renderer/data-sources/launcher", () => ({
  Launcher: {
    Context: {
      use: useLauncherContextMock,
    },
  },
}));

import { Launcher } from "../../../../renderer/data-sources/launcher";
import type { LauncherStatus } from "../../../../renderer/data-sources/launcher";
import { LauncherControls } from "../../../../renderer/components/header/LauncherControls";

type LauncherContextValue = ReturnType<typeof Launcher.Context.use>;

const baseContextValue: LauncherContextValue = {
  status: "stopped",
  reportedStatus: "stopped",
  lastError: null,
  isBusy: false,
  isAwaitingStatus: false,
  isRobotAlive: true,
  robotAliveLoading: false,
  robotAliveError: null,
  launcherModels: {},
  modelHealth: {},
  run: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
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

    expect(container.textContent).toContain("Launcher Status");
    expect(container.textContent).toContain("Running");
    expect(container.textContent).toContain("alf-e-face");
    expect(container.textContent).toContain("Not Running");
    expect(container.textContent).toContain("alf-e-spine");
    expect(container.textContent).toContain("flatlined");
    unmount();
  });

  it("treats successfully launched esp32-style models as running in the tooltip", () => {
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

  afterEach(() => {
    useLauncherContextMock.mockReset();
  });
});
