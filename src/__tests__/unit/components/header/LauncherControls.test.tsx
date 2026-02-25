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

  it("disables the play button while a run request is in-flight", () => {
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
    expect(buttons[0].disabled).toBe(true);
    unmount();
  });

  afterEach(() => {
    useLauncherContextMock.mockReset();
  });
});
