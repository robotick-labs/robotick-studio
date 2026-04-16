import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useProjectContext } from "./ProjectContext";
import {
  fetchProjectSettingsList,
  ProjectSettingsSummary,
} from "./projects-api";
import type { ProjectModelDescriptor } from "./launcher-interface";
import {
  RcModuleDescriptor,
  RcSettingsResponse,
  normalizeRcModules,
} from "./remote-control-types";
import { useLauncherService } from "./LauncherService";

type LoadState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
};

type LauncherDataValue = {
  projectSettings: LoadState<ProjectSettingsSummary[]>;
  projectModels: LoadState<ProjectModelDescriptor[]>;
  rcModules: LoadState<RcModuleDescriptor[]>;
  refreshProjectSettings: () => Promise<void>;
  refreshProjectModels: () => Promise<void>;
  refreshRcModules: () => Promise<void>;
  findModelByName: (
    modelName: string
  ) => ProjectModelDescriptor | undefined;
};

type ProjectModelsState = LoadState<ProjectModelDescriptor[]>;
type ProjectModelsListener = (state: ProjectModelsState) => void;

let latestProjectModelsState: ProjectModelsState = {
  data: [],
  loading: true,
  error: null,
};

const projectModelsListeners = new Set<ProjectModelsListener>();

function notifyProjectModelsListeners(state: ProjectModelsState) {
  latestProjectModelsState = state;
  projectModelsListeners.forEach((listener) => {
    try {
      listener(state);
    } catch (err) {
      console.error("Error in project models listener", err);
    }
  });
}

export function getProjectModelsStateSnapshot(): ProjectModelsState {
  return latestProjectModelsState;
}

/**
 * Subscribes to updates of the project models state and immediately invokes the listener with the current state.
 *
 * @param listener - Callback invoked whenever the project models state changes; also invoked immediately with the current state.
 * @returns A function that unsubscribes the listener so it will no longer receive updates.
 */
export function subscribeProjectModelsState(
  listener: ProjectModelsListener
): () => void {
  projectModelsListeners.add(listener);
  listener(latestProjectModelsState);
  return () => projectModelsListeners.delete(listener);
}

/**
 * @internal
 * @testonly Resets cached launcher data/listeners between tests.
 */
export function resetLauncherDataForTests() {
  latestProjectModelsState = {
    data: [],
    loading: true,
    error: null,
  };
  projectModelsListeners.clear();
}

/**
 * Waits until the project models finish loading and returns the final state.
 *
 * If the models are already loaded, the current state is returned immediately.
 *
 * @returns The project models state when `loading` is false
 */
export async function waitForProjectModelsLoaded(): Promise<ProjectModelsState> {
  const current = latestProjectModelsState;
  if (!current.loading) {
    return current;
  }

  return await new Promise<ProjectModelsState>((resolve) => {
    const unsubscribe = subscribeProjectModelsState((state) => {
      if (!state.loading) {
        unsubscribe();
        resolve(state);
      }
    });
  });
}

function normalizeModelKey(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function findModelByNameInList(
  models: ProjectModelDescriptor[],
  modelName?: string | null
): ProjectModelDescriptor | undefined {
  const key = normalizeModelKey(modelName);
  if (!key) return undefined;
  return models.find((model) => {
    const shortKey = normalizeModelKey(model.modelShortName);
    if (shortKey && shortKey === key) {
      return true;
    }
    const friendlyKey = normalizeModelKey(model.modelName);
    return Boolean(friendlyKey && friendlyKey === key);
  });
}

export function findModelDescriptorInState(
  state: ProjectModelsState,
  modelName: string
): ProjectModelDescriptor | undefined {
  return findModelByNameInList(state.data, modelName);
}

export async function waitForModelDescriptorByName(
  modelName: string
): Promise<ProjectModelDescriptor | null> {
  if (!modelName) return null;
  const state = await waitForProjectModelsLoaded();
  return findModelByNameInList(state.data, modelName) ?? null;
}

const PROJECT_METAS_POLL_MS = 30000;

const LauncherDataContext = createContext<LauncherDataValue | undefined>(
  undefined
);

function areProjectSettingsEqual(
  left: ProjectSettingsSummary[],
  right: ProjectSettingsSummary[]
) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (
      a?.path !== b?.path ||
      a?.name !== b?.name ||
      a?.description !== b?.description
    ) {
      return false;
    }
  }
  return true;
}

function areRcModulesEqual(
  left: RcModuleDescriptor[],
  right: RcModuleDescriptor[]
) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a?.type !== b?.type) {
      return false;
    }
    if (JSON.stringify(a?.config ?? null) !== JSON.stringify(b?.config ?? null)) {
      return false;
    }
  }
  return true;
}

export function LauncherDataProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const launcherService = useLauncherService();
  const { projectPath } = useProjectContext();
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [projectSettings, setProjectSettings] = useState<
    LoadState<ProjectSettingsSummary[]>
  >({
    data: [],
    loading: true,
    error: null,
  });

  const [projectModels, setProjectModels] = useState<
    LoadState<ProjectModelDescriptor[]>
  >({
    data: [],
    loading: true,
    error: null,
  });

  const [rcModules, setRcModules] = useState<LoadState<RcModuleDescriptor[]>>({
    data: [],
    loading: false,
    error: null,
  });

  const modelsRequestRef = useRef(0);
  const metasRequestRef = useRef(0);
  const rcRequestRef = useRef(0);

  const refreshProjectSettings = useCallback(async () => {
    const requestId = ++metasRequestRef.current;
    setProjectSettings((prev) => ({
      ...prev,
      loading: prev.data.length === 0,
      error: null,
    }));
    try {
      const summaries = await fetchProjectSettingsList();
      if (!isMountedRef.current || metasRequestRef.current !== requestId) {
        return;
      }
      setProjectSettings((prev) =>
        areProjectSettingsEqual(prev.data, summaries) &&
        prev.loading === false &&
        prev.error === null
          ? prev
          : { data: summaries, loading: false, error: null }
      );
    } catch (err) {
      if (!isMountedRef.current || metasRequestRef.current !== requestId) {
        return;
      }
      setProjectSettings((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const refreshProjectModels = useCallback(async () => {
    const requestId = ++modelsRequestRef.current;
    if (!projectPath) {
      setProjectModels({ data: [], loading: false, error: null });
      return;
    }
    setProjectModels((prev) => ({
      ...prev,
      loading: prev.data.length === 0,
      error: null,
    }));
    try {
      const models =
        await launcherService.refreshProjectModels(projectPath);
      if (!isMountedRef.current || modelsRequestRef.current !== requestId) {
        return;
      }
      setProjectModels({ data: models, loading: false, error: null });
    } catch (err) {
      if (!isMountedRef.current || modelsRequestRef.current !== requestId) {
        return;
      }
      setProjectModels((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [launcherService, projectPath]);

  const refreshRcModules = useCallback(async () => {
    const requestId = ++rcRequestRef.current;
    if (!projectPath) {
      setRcModules({ data: [], loading: false, error: null });
      return;
    }
    setRcModules((prev) => ({
      ...prev,
      loading: prev.data.length === 0,
      error: null,
    }));
    try {
      const settings =
        await launcherService.fetchProjectRemoteControlSettings<
          RcSettingsResponse
        >(projectPath);
      if (!isMountedRef.current || rcRequestRef.current !== requestId) {
        return;
      }
      const normalized = normalizeRcModules(settings ?? null);
      setRcModules((prev) =>
        areRcModulesEqual(prev.data, normalized) &&
        prev.loading === false &&
        prev.error === null
          ? prev
          : {
              data: normalized,
              loading: false,
              error: null,
            }
      );
    } catch (err) {
      if (!isMountedRef.current || rcRequestRef.current !== requestId) {
        return;
      }
      setRcModules((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [launcherService, projectPath]);

  useEffect(() => {
    void refreshProjectSettings();
    const intervalId = window.setInterval(
      () => void refreshProjectSettings(),
      PROJECT_METAS_POLL_MS
    );
    return () => window.clearInterval(intervalId);
  }, [refreshProjectSettings]);

  useEffect(() => {
    void refreshProjectModels();
  }, [projectPath, refreshProjectModels]);

  useEffect(() => {
    void refreshRcModules();
  }, [projectPath, refreshRcModules]);

  useEffect(() => {
    notifyProjectModelsListeners(projectModels);
  }, [projectModels]);

  const value = useMemo<LauncherDataValue>(
    () => ({
      projectSettings,
      projectModels,
      rcModules,
      refreshProjectSettings,
      refreshProjectModels,
      refreshRcModules,
      findModelByName: (name: string) =>
        findModelByNameInList(projectModels.data, name),
    }),
    [
      projectModels.data,
      projectSettings,
      projectModels,
      rcModules,
      refreshProjectSettings,
      refreshProjectModels,
      refreshRcModules,
    ]
  );

  return (
    <LauncherDataContext.Provider value={value}>
      {children}
    </LauncherDataContext.Provider>
  );
}

export function useLauncherData(): LauncherDataValue {
  const ctx = useContext(LauncherDataContext);
  if (!ctx) {
    throw new Error("useLauncherData must be used within LauncherDataProvider");
  }
  return ctx;
}
