import React, { act } from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createRoot } from "react-dom/client";

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

vi.mock("../../../../renderer/utils/environment", () => electronModule);

const contextMenuModule = vi.hoisted(() => ({
  useContextMenu: vi.fn(),
}));

vi.mock(
  "../../../../renderer/components/context-menu/ContextMenuProvider",
  () => contextMenuModule
);

import { AppHeader } from "../../../../renderer/components/header/AppHeader";
import { isStandaloneElectron } from "../../../../renderer/utils/environment";
import { useContextMenu } from "../../../../renderer/components/context-menu/ContextMenuProvider";

const useContextMenuMock = useContextMenu as unknown as vi.Mock;

describe("AppHeader window controls", () => {
  let contextMenuHandlers: {
    showHeaderMenu: ReturnType<typeof vi.fn>;
    showPanelMenu: ReturnType<typeof vi.fn>;
    hideMenu: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    (isStandaloneElectron as vi.Mock).mockReturnValue(false);
    contextMenuHandlers = {
      showHeaderMenu: vi.fn(),
      showPanelMenu: vi.fn(),
      hideMenu: vi.fn(),
    };
    useContextMenuMock.mockReturnValue(contextMenuHandlers);
    if (typeof window !== "undefined") {
      (window as typeof window & { robotick?: unknown }).robotick = undefined;
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0",
      });
    }
  });

  it("does not render window controls in hosted mode", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );
    expect(markup).not.toContain('data-testid="window-controls"');
  });

  it("renders window controls when running in the Electron shell", () => {
    (isStandaloneElectron as vi.Mock).mockReturnValue(true);
    (window as typeof window & {
      robotick?: {
        environment?: { isStandaloneApp: boolean; appTitle: string };
        windowControls?: Record<string, () => void>;
      };
    }).robotick = {
      environment: { isStandaloneApp: true, appTitle: "Robotick Studio" },
      windowControls: {
        minimize: () => {},
        maximize: () => {},
        restore: () => {},
        close: () => {},
        toggleMaximize: () => {},
        onStateChange: () => () => {},
      },
    };

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );
    expect(markup).toContain('data-testid="window-controls"');
  });

  it("requests the header context menu when right-clicking the header in standalone mode", () => {
    (isStandaloneElectron as vi.Mock).mockReturnValue(true);
    (window as typeof window & {
      robotick?: {
        environment?: { isStandaloneApp: boolean; appTitle: string };
        windowControls?: Record<string, () => void>;
      };
    }).robotick = {
      environment: { isStandaloneApp: true, appTitle: "Robotick Studio" },
      windowControls: {
        minimize: () => {},
        maximize: () => {},
        restore: () => {},
        close: () => {},
        toggleMaximize: () => {},
        onStateChange: () => () => {},
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
    act(() => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 24,
        clientY: 48,
        screenX: 24,
        screenY: 48,
      });
      header?.dispatchEvent(event);
    });

    expect(contextMenuHandlers.showHeaderMenu).toHaveBeenCalledWith({
      x: 24,
      y: 48,
    });
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("does not request the header menu when not in standalone mode", () => {
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
    act(() => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        screenX: 10,
        screenY: 10,
      });
      header?.dispatchEvent(event);
    });

    expect(contextMenuHandlers.showHeaderMenu).not.toHaveBeenCalled();
    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
