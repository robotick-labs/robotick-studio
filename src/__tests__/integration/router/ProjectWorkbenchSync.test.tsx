import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../../renderer/Router";
import { TestLauncherProviders } from "../../helpers/mocks";
import { createMockLauncherService } from "../../../renderer/data-sources/launcher";

const appConfigState = vi.hoisted(() => ({
  workbenches: [
    {
      id: "home",
      path: "/home",
      label: "Home",
      group: "project-select",
      editor: "home",
    },
  ],
  loading: false,
}));

vi.mock("../../../renderer/components/workbenches/WorkbenchView", () => ({
  WorkbenchView: ({ workbench }: { workbench: { id: string } }) => (
    <div data-testid={`workbench-${workbench.id}`}>{workbench.id}</div>
  ),
}));

vi.mock("../../../renderer/services/AppConfigService", async () => {
  const actual = await vi.importActual<
    typeof import("../../../renderer/services/AppConfigService")
  >("../../../renderer/services/AppConfigService");
  return {
    ...actual,
    useAppConfig: () => ({
      workbenches: appConfigState.workbenches,
      windows: [],
      editors: [],
      loading: appConfigState.loading,
      source: "canonical" as const,
    }),
  };
});

afterEach(() => {
  window.robotick = undefined;
  window.localStorage.clear();
});

describe("ProjectWorkbenchSync", () => {
  it("keeps the current route on project switch when that workbench still exists and no remembered route overrides it", async () => {
    const service = createMockLauncherService({
      projectPath: "/repo/robots/barr-e/barr-e.project.yaml",
    });
    appConfigState.loading = false;
    appConfigState.workbenches = [
      {
        id: "home",
        path: "/home",
        label: "Home",
        group: "project-select",
        editor: "home",
      },
      {
        id: "project",
        path: "/project",
        label: "Project",
        group: "dev",
        editor: "project",
      },
    ];

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TestLauncherProviders service={service}>
          <MemoryRouter initialEntries={["/project"]}>
            <AppRoutes />
          </MemoryRouter>
        </TestLauncherProviders>
      );
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('data-testid="workbench-project"');

    await act(async () => {
      appConfigState.loading = true;
      service.setProjectPath("/repo/robots/tim-e/tim-e.project.yaml");
      await Promise.resolve();
    });

    await act(async () => {
      appConfigState.loading = false;
      root.render(
        <TestLauncherProviders service={service}>
          <MemoryRouter initialEntries={["/project"]}>
            <AppRoutes />
          </MemoryRouter>
        </TestLauncherProviders>
      );
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('data-testid="workbench-project"');
    expect(container.innerHTML).not.toContain('data-testid="workbench-home"');

    await act(async () => {
      root.unmount();
    });
  });

  it("revalidates the route after a project switch finishes loading a different workbench set", async () => {
    const service = createMockLauncherService({
      projectPath: "/repo/robots/barr-e/barr-e.project.yaml",
    });
    appConfigState.loading = false;
    appConfigState.workbenches = [
      {
        id: "home",
        path: "/home",
        label: "Home",
        group: "project-select",
        editor: "home",
      },
      {
        id: "telemetry",
        path: "/telemetry",
        label: "Telemetry",
        group: "test",
        editor: "telemetry",
      },
    ];
    window.localStorage.setItem(
      "robotick:last-workbench:%2Frepo%2Frobots%2Fbarr-e%2Fbarr-e.project.yaml",
      "/telemetry"
    );

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TestLauncherProviders service={service}>
          <MemoryRouter initialEntries={["/home"]}>
            <AppRoutes />
          </MemoryRouter>
        </TestLauncherProviders>
      );
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('data-testid="workbench-telemetry"');

    await act(async () => {
      appConfigState.loading = true;
      service.setProjectPath("/repo/robots/tim-e/tim-e.project.yaml");
      await Promise.resolve();
    });

    await act(async () => {
      appConfigState.workbenches = [
        {
          id: "home",
          path: "/home",
          label: "Home",
          group: "project-select",
          editor: "home",
        },
        {
          id: "project",
          path: "/project",
          label: "Project",
          group: "dev",
          editor: "project",
        },
      ];
      appConfigState.loading = false;
      root.render(
        <TestLauncherProviders service={service}>
          <MemoryRouter initialEntries={["/home"]}>
            <AppRoutes />
          </MemoryRouter>
        </TestLauncherProviders>
      );
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('data-testid="workbench-home"');
    expect(container.innerHTML).not.toContain('data-testid="workbench-telemetry"');

    await act(async () => {
      root.unmount();
    });
  });

  it("navigates to a workbench when Studio control activates it", async () => {
    const service = createMockLauncherService({
      projectPath: "/repo/robots/barr-e/barr-e.project.yaml",
    });
    appConfigState.loading = false;
    appConfigState.workbenches = [
      {
        id: "home",
        path: "/home",
        label: "Home",
        group: "project-select",
        editor: "home",
      },
      {
        id: "project",
        path: "/project",
        label: "Project",
        group: "dev",
        editor: "project",
      },
    ];
    const activationListeners = new Set<
      (event: { activated_path: string[] }) => void
    >();
    window.robotick = {
      environment: {
        isStandaloneApp: true,
        appTitle: "Robotick Studio",
        windowScope: "primary",
        isPrimaryWindow: true,
      },
      studioControl: {
        reportActiveResource: vi.fn(),
        onActivationChanged: (callback) => {
          activationListeners.add(callback);
          return () => activationListeners.delete(callback);
        },
      },
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TestLauncherProviders service={service}>
          <MemoryRouter initialEntries={["/project"]}>
            <AppRoutes />
          </MemoryRouter>
        </TestLauncherProviders>
      );
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('data-testid="workbench-project"');

    await act(async () => {
      for (const listener of activationListeners) {
        listener({
          activated_path: ["windows", "main", "workbenches", "home"],
        });
      }
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('data-testid="workbench-home"');
    expect(container.innerHTML).not.toContain('data-testid="workbench-project"');

    await act(async () => {
      root.unmount();
    });
  });

  it("applies the last Studio control activation when it arrived before the route listener mounted", async () => {
    const service = createMockLauncherService({
      projectPath: "/repo/robots/barr-e/barr-e.project.yaml",
    });
    appConfigState.loading = false;
    appConfigState.workbenches = [
      {
        id: "home",
        path: "/home",
        label: "Home",
        group: "project-select",
        editor: "home",
      },
      {
        id: "project",
        path: "/project",
        label: "Project",
        group: "dev",
        editor: "project",
      },
    ];
    window.robotick = {
      environment: {
        isStandaloneApp: true,
        appTitle: "Robotick Studio",
        windowScope: "primary",
        isPrimaryWindow: true,
      },
      studioControl: {
        reportActiveResource: vi.fn(),
        getLastActivation: () => ({
          activated_path: ["windows", "main", "workbenches", "home"],
        }),
        onActivationChanged: () => () => {},
      },
    };

    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TestLauncherProviders service={service}>
          <MemoryRouter initialEntries={["/project"]}>
            <AppRoutes />
          </MemoryRouter>
        </TestLauncherProviders>
      );
      await Promise.resolve();
    });

    expect(container.innerHTML).toContain('data-testid="workbench-home"');
    expect(container.innerHTML).not.toContain('data-testid="workbench-project"');

    await act(async () => {
      root.unmount();
    });
  });
});
