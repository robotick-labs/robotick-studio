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
