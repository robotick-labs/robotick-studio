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
import { fetchProjectMetas, ProjectMeta } from "./projects-api";
import currentProject, {
  ProjectModelDescriptor,
  fetchProjectRemoteControlSettings,
} from "./launcher-interface";
import {
  RcModuleDescriptor,
  RcSettingsResponse,
  normalizeRcModules,
} from "./remote-control-types";

type LoadState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
};

type LauncherDataValue = {
  projectMetas: LoadState<ProjectMeta[]>;
  projectModels: LoadState<ProjectModelDescriptor[]>;
  rcModules: LoadState<RcModuleDescriptor[]>;
  refreshProjectMetas: () => Promise<void>;
  refreshProjectModels: () => Promise<void>;
  refreshRcModules: () => Promise<void>;
  findModelByShortName: (
    shortName: string
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

export function subscribeProjectModelsState(
  listener: ProjectModelsListener
): () => void {
  projectModelsListeners.add(listener);
  listener(latestProjectModelsState);
  return () => projectModelsListeners.delete(listener);
}

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

const PROJECT_METAS_POLL_MS = 5000;
const PROJECT_MODELS_POLL_MS = 5000;
const RC_MODULES_POLL_MS = 10000;

const LauncherDataContext = createContext<LauncherDataValue | undefined>(
  undefined
);

export function LauncherDataProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { projectPath } = useProjectContext();
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [projectMetas, setProjectMetas] = useState<LoadState<ProjectMeta[]>>({
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

  const refreshProjectMetas = useCallback(async () => {
    const requestId = ++metasRequestRef.current;
    setProjectMetas((prev) => ({
      ...prev,
      loading: prev.data.length === 0,
      error: null,
    }));
    try {
      const metas = await fetchProjectMetas();
      if (!isMountedRef.current || metasRequestRef.current !== requestId) {
        return;
      }
      setProjectMetas({ data: metas, loading: false, error: null });
    } catch (err) {
      if (!isMountedRef.current || metasRequestRef.current !== requestId) {
        return;
      }
      setProjectMetas((prev) => ({
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
      const models = await currentProject.refreshProjectModels(projectPath);
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
  }, [projectPath]);

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
      const settings = await fetchProjectRemoteControlSettings<
        RcSettingsResponse
      >(projectPath);
      if (!isMountedRef.current || rcRequestRef.current !== requestId) {
        return;
      }
      setRcModules({
        data: normalizeRcModules(settings ?? null),
        loading: false,
        error: null,
      });
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
  }, [projectPath]);

  useEffect(() => {
    void refreshProjectMetas();
    const intervalId = window.setInterval(
      () => void refreshProjectMetas(),
      PROJECT_METAS_POLL_MS
    );
    return () => window.clearInterval(intervalId);
  }, [refreshProjectMetas]);

  useEffect(() => {
    void refreshProjectModels();
    if (!projectPath) {
      return;
    }
    const intervalId = window.setInterval(
      () => void refreshProjectModels(),
      PROJECT_MODELS_POLL_MS
    );
    return () => window.clearInterval(intervalId);
  }, [projectPath, refreshProjectModels]);

  useEffect(() => {
    void refreshRcModules();
    if (!projectPath) {
      return;
    }
    const intervalId = window.setInterval(
      () => void refreshRcModules(),
      RC_MODULES_POLL_MS
    );
    return () => window.clearInterval(intervalId);
  }, [projectPath, refreshRcModules]);

  useEffect(() => {
    notifyProjectModelsListeners(projectModels);
  }, [projectModels]);

  const modelByShortName = useMemo(() => {
    const map = new Map<string, ProjectModelDescriptor>();
    for (const model of projectModels.data) {
      map.set(model.modelShortName, model);
    }
    return map;
  }, [projectModels.data]);

  const value = useMemo<LauncherDataValue>(
    () => ({
      projectMetas,
      projectModels,
      rcModules,
      refreshProjectMetas,
      refreshProjectModels,
      refreshRcModules,
      findModelByShortName: (shortName: string) =>
        modelByShortName.get(shortName),
    }),
    [
      modelByShortName,
      projectMetas,
      projectModels,
      rcModules,
      refreshProjectMetas,
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
