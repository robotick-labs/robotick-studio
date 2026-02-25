import React from "react";
import { vi } from "vitest";
import {
  Launcher,
  LauncherServiceProvider,
  Project,
  ProjectData,
  type LauncherService,
  createMockLauncherService,
} from "../../renderer/data-sources/launcher";
export { createMockLauncherService };

/**
 * Registers a test mock for the WorkspaceView component that renders a div showing the workspace id.
 *
 * The mocked component renders a div with text equal to the workspace's `id` and a `data-testid` of `workspace-{id}` so tests can locate workspace instances.
 */
export function mockWorkspaceView() {
  vi.mock("../../renderer/components/workspaces/WorkspaceView", () => ({
    WorkspaceView: ({ workspace }: { workspace: { id: string } }) => (
      <div data-testid={`workspace-${workspace.id}`}>{workspace.id}</div>
    ),
  }));
}

type TestLauncherProvidersProps = {
  service?: LauncherService;
  serviceOverrides?: Partial<LauncherService>;
  projectPath?: string;
  launcherProfile?: string;
  children: React.ReactNode;
};

/**
 * Renders `children` wrapped with launcher-related context providers for testing.
 *
 * @param service - Optional `LauncherService` instance to provide; if omitted a mock service is created.
 * @param serviceOverrides - Partial properties merged into the created mock service when `service` is not provided.
 * @param projectPath - Optional project path passed to the mock service when it is created.
 * @param launcherProfile - Optional launcher profile passed to the mock service when it is created.
 * @param children - React nodes to render inside the provider tree.
 * @returns A React element that supplies launcher contexts (service, project, project data, and launcher) to `children`.
 */
export function TestLauncherProviders({
  service,
  serviceOverrides,
  projectPath,
  launcherProfile,
  children,
}: TestLauncherProvidersProps) {
  const resolvedService =
    service ??
    createMockLauncherService({
      projectPath,
      launcherProfile,
      ...(serviceOverrides ?? {}),
    });
  return (
    <LauncherServiceProvider service={resolvedService}>
      <Project.Context.Provider>
        <ProjectData.Provider>
          <Launcher.Context.Provider>{children}</Launcher.Context.Provider>
        </ProjectData.Provider>
      </Project.Context.Provider>
    </LauncherServiceProvider>
  );
}