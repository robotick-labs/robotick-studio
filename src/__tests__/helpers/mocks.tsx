import React from "react";
import { vi } from "vitest";
import {
  Launcher,
  LauncherServiceProvider,
  Project,
  ProjectData,
  type LauncherService,
} from "../../renderer/data-sources/launcher";

export function mockWorkspaceView() {
  vi.mock("../../renderer/components/workspaces/WorkspaceView", () => ({
    WorkspaceView: ({ workspace }: { workspace: { id: string } }) => (
      <div data-testid={`workspace-${workspace.id}`}>{workspace.id}</div>
    ),
  }));
}

type MockServiceOptions = {
  projectPath?: string;
  launcherProfile?: string;
  overrides?: Partial<LauncherService>;
};

export function createMockLauncherService({
  projectPath = "/mock/project",
  launcherProfile = "local:ALL",
  overrides,
}: MockServiceOptions = {}): LauncherService {
  let currentProjectPath = projectPath;
  let currentLauncherProfile = launcherProfile;
  const projectListeners = new Set<(path: string) => void>();
  const profileListeners = new Set<(profile: string) => void>();

  const notifyProject = () => {
    projectListeners.forEach((listener) => {
      try {
        listener(currentProjectPath);
      } catch (err) {
        console.warn("[mockLauncherService] project listener error", err);
      }
    });
  };

  const notifyProfile = () => {
    profileListeners.forEach((listener) => {
      try {
        listener(currentLauncherProfile);
      } catch (err) {
        console.warn("[mockLauncherService] profile listener error", err);
      }
    });
  };

  const base: LauncherService = {
    setProjectPath(path: string) {
      currentProjectPath = path;
      notifyProject();
    },
    getProjectPath() {
      return currentProjectPath;
    },
    onProjectChanged(callback: (path: string) => void) {
      projectListeners.add(callback);
      return () => projectListeners.delete(callback);
    },
    setLauncherProfile(profile: string) {
      currentLauncherProfile = profile;
      notifyProfile();
    },
    getLauncherProfile() {
      return currentLauncherProfile;
    },
    onLauncherProfileChanged(callback: (profile: string) => void) {
      profileListeners.add(callback);
      return () => profileListeners.delete(callback);
    },
    async fetchProjectPaths() {
      return [currentProjectPath];
    },
    async fetchProjectSettingsData<T = Record<string, unknown>>(
      _projectPath: string
    ) {
      return {} as T;
    },
    async fetchProjectRemoteControlSettings<T = Record<string, unknown>>(
      _projectPath: string,
      _signal?: AbortSignal
    ) {
      return {} as T;
    },
    async fetchProjectModelPaths(_projectPath: string) {
      return [];
    },
    async getProjectModels() {
      return [];
    },
    async refreshProjectModels() {
      return [];
    },
    clearProjectModelCache() {},
    getModelHostName() {
      return "localhost";
    },
    async requestLauncherRun() {},
    async requestLauncherStop() {},
    async fetchLauncherStatus() {
      return { status: "stopped" };
    },
    getLauncherLogStreamUrl() {
      return "ws://localhost/mock-logs";
    },
  };

  if (!overrides) {
    return base;
  }
  return {
    ...base,
    ...overrides,
  };
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
      overrides: serviceOverrides,
      projectPath,
      launcherProfile,
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
