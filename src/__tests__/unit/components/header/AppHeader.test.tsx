import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { act } from "react-dom/test-utils";
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

import { AppHeader } from "../../../../renderer/components/header/AppHeader";
import { isStandaloneElectron } from "../../../../renderer/utils/environment";

describe("AppHeader window controls", () => {
  beforeEach(() => {
    (isStandaloneElectron as vi.Mock).mockReturnValue(false);
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

  it("invokes system menu when right-clicking the header", () => {
    (isStandaloneElectron as vi.Mock).mockReturnValue(true);
    const showSystemMenu = vi.fn();
    (window as typeof window & {
      robotick?: {
        environment?: { isStandaloneApp: boolean; appTitle: string };
        windowControls?: Record<string, (...args: unknown[]) => void>;
      };
    }).robotick = {
      environment: { isStandaloneApp: true, appTitle: "Robotick Studio" },
      windowControls: {
        minimize: () => {},
        maximize: () => {},
        restore: () => {},
        close: () => {},
        toggleMaximize: () => {},
        showSystemMenu,
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
      });
      header?.dispatchEvent(event);
    });

    expect(showSystemMenu).toHaveBeenCalledWith(24, 48);
    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
