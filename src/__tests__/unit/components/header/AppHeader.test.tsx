import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../../../renderer/components/header/LauncherControls", () => ({
  LauncherControls: () => <div data-testid="launcher-controls" />,
}));
vi.mock("../../../../renderer/components/header/ProfilePicker", () => ({
  ProfilePicker: () => <div data-testid="profile-picker" />,
}));
vi.mock("../../../../renderer/components/header/ProjectPicker", () => ({
  ProjectPicker: () => <div data-testid="project-picker" />,
}));
vi.mock("../../../../renderer/services/AppConfigService", () => ({
  useAppConfig: () => ({
    workspaces: [
      {
        id: "home",
        path: "/home",
        label: "Home",
        group: "project-select",
        editor: "home",
      },
    ],
  }),
}));

const electronModule = vi.hoisted(() => ({
  isStandaloneElectron: vi.fn(),
}));

const contextMenuModule = vi.hoisted(() => ({
  useContextMenu: vi.fn(),
}));

vi.mock("../../../../renderer/utils/environment", () => electronModule);
vi.mock(
  "../../../../renderer/components/context-menu/ContextMenuProvider",
  () => contextMenuModule
);

import { AppHeader } from "../../../../renderer/components/header/AppHeader";
import { isStandaloneElectron } from "../../../../renderer/utils/environment";
import { useContextMenu } from "../../../../renderer/components/context-menu/ContextMenuProvider";

const useContextMenuMock = useContextMenu as unknown as vi.Mock;

type RobotickEnvOptions = {
  usesNativeWindowFrame?: boolean;
  includeWindowControls?: boolean;
  studioProcessStats?: { cpuPercent: number; memoryMb: number };
};

function setRobotickEnvironment({
  usesNativeWindowFrame = true,
  includeWindowControls = false,
  studioProcessStats,
}: RobotickEnvOptions = {}): void {
  if (typeof window === "undefined") {
    return;
  }
  const windowControls = includeWindowControls
    ? {
        minimize: vi.fn(),
        maximize: vi.fn(),
        restore: vi.fn(),
        close: vi.fn(),
        toggleMaximize: vi.fn(),
        onStateChange: vi.fn(() => () => {}),
      }
    : undefined;
  (window as typeof window & { robotick?: any }).robotick = {
    environment: {
      isStandaloneApp: true,
      appTitle: "Robotick Studio",
      usesNativeWindowFrame,
    },
    ...(windowControls ? { windowControls } : {}),
    ...(studioProcessStats
      ? {
          studioProcess: {
            getStats: vi.fn().mockResolvedValue(studioProcessStats),
          },
        }
      : {}),
  };
}

describe("AppHeader", () => {
  let contextMenuHandlers: {
    showPanelMenu: ReturnType<typeof vi.fn>;
    showHeaderMenu: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    (isStandaloneElectron as vi.Mock).mockReturnValue(false);
    contextMenuHandlers = {
      showPanelMenu: vi.fn(),
      showHeaderMenu: vi.fn(),
    };
    useContextMenuMock.mockReturnValue(contextMenuHandlers);
    setRobotickEnvironment();
    if (typeof window !== "undefined") {
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0",
      });
    }
  });

  it("renders without custom window control markup while using native frame", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );
    expect(markup).not.toContain('data-testid="window-controls"');
  });

  it("renders custom window controls when standalone and frameless", () => {
    (isStandaloneElectron as vi.Mock).mockReturnValue(true);
    setRobotickEnvironment({
      usesNativeWindowFrame: false,
      includeWindowControls: true,
    });
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );
    expect(markup).toContain('data-testid="window-controls"');
  });

  it("shows studio CPU/memory stats beside window controls", async () => {
    (isStandaloneElectron as vi.Mock).mockReturnValue(true);
    setRobotickEnvironment({
      usesNativeWindowFrame: false,
      includeWindowControls: true,
      studioProcessStats: {
        cpuPercent: 12.34,
        memoryMb: 456,
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <AppHeader />
        </MemoryRouter>
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Studio: CPU 12.3% Mem: 456MB");
    });

    const headerRight = container.querySelector(
      '[data-testid="window-controls"]'
    )?.parentElement;
    const presetSelector = container.querySelector(
      'button[aria-label="Select window preset"]'
    );
    const stats = container.querySelector('[data-testid="studio-process-stats"]');
    expect(headerRight?.firstElementChild).toBe(
      presetSelector?.parentElement ?? null
    );
    expect(presetSelector?.parentElement?.nextElementSibling).toBe(stats);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("opens the header context menu on right click when frameless", () => {
    (isStandaloneElectron as vi.Mock).mockReturnValue(true);
    setRobotickEnvironment({
      usesNativeWindowFrame: false,
      includeWindowControls: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <MemoryRouter>
          <AppHeader />
        </MemoryRouter>
      );
    });

    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 42,
      clientY: 64,
    });
    header?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(contextMenuHandlers.showHeaderMenu).toHaveBeenCalledWith({
      x: 42,
      y: 64,
    });

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
