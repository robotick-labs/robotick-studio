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
    if (typeof window !== "undefined") {
      (window as typeof window & { robotick?: any }).robotick = {
        environment: {
          isStandaloneApp: true,
          appTitle: "Robotick Studio",
          usesNativeWindowFrame: true,
        },
      };
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
    (window as typeof window & { robotick?: any }).robotick = {
      environment: {
        isStandaloneApp: true,
        appTitle: "Robotick Studio",
        usesNativeWindowFrame: false,
      },
      windowControls: {
        minimize: vi.fn(),
        maximize: vi.fn(),
        restore: vi.fn(),
        close: vi.fn(),
        toggleMaximize: vi.fn(),
        onStateChange: vi.fn(() => () => {}),
      },
    };
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );
    expect(markup).toContain('data-testid="window-controls"');
  });

  it("opens the header context menu on right click when frameless", () => {
    (isStandaloneElectron as vi.Mock).mockReturnValue(true);
    (window as typeof window & { robotick?: any }).robotick = {
      environment: {
        isStandaloneApp: true,
        appTitle: "Robotick Studio",
        usesNativeWindowFrame: false,
      },
      windowControls: {
        minimize: vi.fn(),
        maximize: vi.fn(),
        restore: vi.fn(),
        close: vi.fn(),
        toggleMaximize: vi.fn(),
        onStateChange: vi.fn(() => () => {}),
      },
    };
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
