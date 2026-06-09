import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "yaml";

vi.mock("../../../../renderer/components/header/LauncherControls", () => ({
  LauncherControls: () => <div data-testid="launcher-controls" />,
}));
vi.mock("../../../../renderer/components/header/ProfilePicker", () => ({
  ProfilePicker: () => <div data-testid="profile-picker" />,
}));
vi.mock("../../../../renderer/components/header/ProjectPicker", () => ({
  ProjectPicker: () => <div data-testid="project-picker" />,
}));
const appConfigModule = vi.hoisted(() => ({
  useAppConfig: vi.fn(),
}));

vi.mock("../../../../renderer/services/AppConfigService", () => appConfigModule);
vi.mock(
  "../../../../renderer/data-sources/launcher/internal/ProjectContext",
  () => ({
    useProjectContext: () => ({
      projectPath: "/repo/robots/barr-e/barr-e.project.yaml",
    }),
  })
);

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
  windowScope?: string;
  isPrimaryWindow?: boolean;
  studioPersistence?: {
    readStudioDocument: ReturnType<typeof vi.fn>;
    ensureStudioDocument: ReturnType<typeof vi.fn>;
    writeStudioDocument: ReturnType<typeof vi.fn>;
  };
};

function setRobotickEnvironment({
  usesNativeWindowFrame = true,
  includeWindowControls = false,
  studioProcessStats,
  windowScope = "primary",
  isPrimaryWindow = true,
  studioPersistence,
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
        createWindow: vi.fn(),
        getChildWindowScopes: vi.fn().mockResolvedValue([]),
        toggleMaximize: vi.fn(),
        onStateChange: vi.fn(() => () => {}),
      }
    : undefined;
  (window as typeof window & { robotick?: any }).robotick = {
    environment: {
      isStandaloneApp: true,
      appTitle: "Robotick Studio",
      usesNativeWindowFrame,
      windowScope,
      isPrimaryWindow,
    },
    ...(windowControls ? { windowControls } : {}),
    ...(studioPersistence ? { studioPersistence } : {}),
    ...(studioProcessStats
      ? {
          studioProcess: {
            getStats: vi.fn().mockResolvedValue(studioProcessStats),
          },
        }
      : {}),
  };
}

function getDefaultAppConfig() {
  return {
    workbenches: [
      {
        id: "home",
        path: "/home",
        label: "Home",
        group: "project-select",
        editor: "home",
      },
    ],
    windows: [
      {
        id: "main",
        label: "Main Window",
        windowRole: "main",
        defaultWorkbenchId: "home",
        workbenches: [],
      },
    ],
    editors: [],
    loading: false,
    source: "canonical",
  };
}

const studioDocumentWithChildWindow = `
resourceType: studio_document
schemaVersion: 1
id: barr-e-studio
windows:
  - id: main
    label: Main Window
    windowRole: main
    defaultWorkbenchId: home
    workbenches:
      - id: home
        label: Home
        layouts:
          - id: main:home:default
            label: Default
            dock:
              nodeType: panel
              panelId: main-home
              editorId: home
  - id: child-telemetry
    label: Telemetry Window
    windowRole: child
    defaultWorkbenchId: telemetry
    workbenches:
      - id: telemetry
        label: Telemetry
        layouts:
          - id: child-telemetry:telemetry:default
            label: Default
            dock:
              nodeType: panel
              panelId: child-telemetry-panel
              editorId: telemetry
`;

describe("AppHeader", () => {
  let contextMenuHandlers: {
    showPanelMenu: ReturnType<typeof vi.fn>;
    showHeaderMenu: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    (isStandaloneElectron as vi.Mock).mockReturnValue(false);
    appConfigModule.useAppConfig.mockReturnValue(getDefaultAppConfig());
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
      'button[aria-label="Select child window"]'
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

  it("renames a child window title through studio document persistence", async () => {
    (isStandaloneElectron as vi.Mock).mockReturnValue(true);
    let writtenContent = "";
    const studioPersistence = {
      readStudioDocument: vi.fn(async () => studioDocumentWithChildWindow),
      ensureStudioDocument: vi.fn(async () => undefined),
      writeStudioDocument: vi.fn(async (_projectPath: string, content: string) => {
        writtenContent = content;
      }),
    };
    appConfigModule.useAppConfig.mockReturnValue({
      ...getDefaultAppConfig(),
      windows: [
        ...getDefaultAppConfig().windows,
        {
          id: "child-telemetry",
          label: "Telemetry Window",
          windowRole: "child",
          defaultWorkbenchId: "telemetry",
          workbenches: [],
        },
      ],
    });
    setRobotickEnvironment({
      usesNativeWindowFrame: false,
      includeWindowControls: true,
      windowScope: "child-telemetry",
      isPrimaryWindow: false,
      studioPersistence,
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
      await Promise.resolve();
    });

    const title = container.querySelector(
      "[aria-label='Rename child window']"
    ) as HTMLElement | null;
    expect(title?.textContent).toBe("Telemetry Window");

    await act(async () => {
      title?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    const input = container.querySelector(
      "input[aria-label='Rename child window']"
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();

    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(input, "Diagnostics Window");
      input.dispatchEvent(
        new Event("input", {
          bubbles: true,
          cancelable: true,
        })
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(studioPersistence.writeStudioDocument).toHaveBeenCalledTimes(1);
    });
    const parsed = parse(writtenContent) as {
      windows: { id: string; label: string }[];
    };
    expect(
      parsed.windows.find((window) => window.id === "child-telemetry")?.label
    ).toBe("Diagnostics Window");
    expect(container.textContent).toContain("Diagnostics Window");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
