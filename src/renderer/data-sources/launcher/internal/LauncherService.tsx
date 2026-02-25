import React, { createContext, useContext, useMemo } from "react";
import type { ProjectModelDescriptor } from "./launcher-interface";
import currentProject from "./launcher-interface";

/**
 * Public contract for anything that needs to talk to the Python Launcher.
 *
 * The default implementation proxies to `launcher-interface.ts`, but keeping
 * this shape explicit allows us to inject mocks/fakes inside tests or future
 * embedders. React code should prefer `LauncherServiceProvider` +
 * `useLauncherService()`, while non-React code can import `launcherService`
 * from the package root.
 */
export interface LauncherService {
  setProjectPath(path: string): void;
  getProjectPath(): string;
  onProjectChanged(callback: (path: string) => void): () => void;

  setLauncherProfile(profile: string): void;
  getLauncherProfile(): string;
  onLauncherProfileChanged(callback: (profile: string) => void): () => void;

  fetchProjectPaths(): Promise<string[]>;
  fetchProjectSettingsData<T = Record<string, unknown>>(
    projectPath: string
  ): Promise<T>;
  fetchProjectRemoteControlSettings<T = Record<string, unknown>>(
    projectPath: string,
    signal?: AbortSignal
  ): Promise<T>;
  fetchProjectModelPaths(projectPath: string): Promise<string[]>;

  getProjectModels(
    projectPath?: string
  ): Promise<ProjectModelDescriptor[]>;
  refreshProjectModels(
    projectPath?: string
  ): Promise<ProjectModelDescriptor[]>;
  clearProjectModelCache(projectPath?: string): void;

  getModelHostName(): string;

  requestLauncherRun(
    projectPath: string,
    launcherProfile: string
  ): Promise<void>;
  requestLauncherStop(): Promise<void>;
  fetchLauncherStatus(): Promise<{ status: string } | null>;
  getLauncherLogStreamUrl(): string;
}

export type LauncherServiceOverrides = Partial<LauncherService>;

export function createLauncherService(
  overrides?: LauncherServiceOverrides
): LauncherService {
  if (!overrides || Object.keys(overrides).length === 0) {
    return currentProject;
  }
  return {
    ...currentProject,
    ...overrides,
  };
}

const LauncherServiceContext = createContext<LauncherService | null>(null);

export function LauncherServiceProvider({
  service,
  children,
}: {
  service?: LauncherService;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => service ?? createLauncherService(),
    [service]
  );

  return (
    <LauncherServiceContext.Provider value={value}>
      {children}
    </LauncherServiceContext.Provider>
  );
}

export function useLauncherService(): LauncherService {
  const ctx = useContext(LauncherServiceContext);
  if (!ctx) {
    throw new Error(
      "useLauncherService must be used within LauncherServiceProvider"
    );
  }
  return ctx;
}

export const launcherService = createLauncherService();
