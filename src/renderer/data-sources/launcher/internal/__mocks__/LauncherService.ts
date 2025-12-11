import type { LauncherService } from "../LauncherService";
import type { ProjectModelDescriptor } from "../launcher-interface";

/**
 * Initialization options for the mock launcher service.
 * `projectPath`/`launcherProfile` seed the internal state, while any
 * properties supplied via `Partial<LauncherService>` replace the corresponding
 * method implementations.
 */
export type LauncherServiceMockOptions = Partial<LauncherService> & {
  projectPath?: string;
  launcherProfile?: string;
};

export function createMockLauncherService(
  options: LauncherServiceMockOptions = {}
): LauncherService {
  const {
    projectPath: initialProjectPath = "mock-project",
    launcherProfile: initialLauncherProfile = "mock-profile",
    ...overrides
  } = options;

  let projectPath = initialProjectPath;
  let launcherProfile = initialLauncherProfile;
  const projectListeners = new Set<(path: string) => void>();
  const profileListeners = new Set<(profile: string) => void>();

  const dispatchProjectChange = (path: string) => {
    projectListeners.forEach((listener) => listener(path));
  };
  const dispatchProfileChange = (profile: string) => {
    profileListeners.forEach((listener) => listener(profile));
  };

  const base: LauncherService = {
    setProjectPath(path: string) {
      projectPath = path;
      dispatchProjectChange(path);
    },
    getProjectPath() {
      return projectPath;
    },
    onProjectChanged(callback) {
      projectListeners.add(callback);
      return () => projectListeners.delete(callback);
    },
    setLauncherProfile(profile: string) {
      launcherProfile = profile;
      dispatchProfileChange(profile);
    },
    getLauncherProfile() {
      return launcherProfile;
    },
    onLauncherProfileChanged(callback) {
      profileListeners.add(callback);
      return () => profileListeners.delete(callback);
    },
    async fetchProjectPaths() {
      return [];
    },
    async fetchProjectSettingsData<T = Record<string, unknown>>() {
      return {} as T;
    },
    async fetchProjectRemoteControlSettings<T = Record<string, unknown>>() {
      return {} as T;
    },
    async fetchProjectModelPaths() {
      return [];
    },
    async getProjectModels() {
      return [] as ProjectModelDescriptor[];
    },
    async refreshProjectModels() {
      return [] as ProjectModelDescriptor[];
    },
    clearProjectModelCache() {},
    getModelHostName() {
      return "mock-host";
    },
    async requestLauncherRun() {},
    async requestLauncherStop() {},
    async fetchLauncherStatus() {
      return { status: "stopped" };
    },
    getLauncherLogStreamUrl() {
      return "ws://mock/logs";
    },
  };

  if (Object.keys(overrides).length === 0) {
    return base;
  }

  return Object.assign({}, base, overrides);
}
