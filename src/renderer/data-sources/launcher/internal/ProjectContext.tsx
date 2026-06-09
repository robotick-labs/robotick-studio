import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLauncherService } from "./LauncherService";
import type {
  ProjectSelectionIssue,
  ProjectSelectionResult,
} from "./launcher-interface";

export type ProjectContextValue = {
  projectPath: string;
  launcherProfile: string;
  setProjectPath: (path: string) => void;
  selectProjectPath: (path: string) => Promise<ProjectSelectionResult>;
  setLauncherProfile: (profile: string) => void;
  bootstrapIssue: ProjectSelectionIssue | null;
};

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const launcherService = useLauncherService();
  const [projectPath, setProjectPathState] = useState(
    () => launcherService.getProjectPath() ?? ""
  );
  const [launcherProfile, setLauncherProfileState] = useState(
    () => launcherService.getLauncherProfile() ?? "local:ALL"
  );
  const [bootstrapIssue, setBootstrapIssue] =
    useState<ProjectSelectionIssue | null>(null);
  const selectionVersionRef = useRef(0);

  useEffect(
    () =>
      launcherService.onProjectChanged((path) => {
        selectionVersionRef.current += 1;
        setProjectPathState(path);
      }),
    [launcherService]
  );
  useEffect(
    () =>
      launcherService.onProjectSelectionStateChanged((state) => {
        selectionVersionRef.current += 1;
        setProjectPathState(state.currentProjectPath);
        setBootstrapIssue(state.bootstrapIssue);
      }),
    [launcherService]
  );
  useEffect(
    () => launcherService.onLauncherProfileChanged(setLauncherProfileState),
    [launcherService]
  );
  useEffect(() => {
    const versionAtRequest = selectionVersionRef.current;
    void launcherService.getProjectSelectionState().then((state) => {
      if (selectionVersionRef.current !== versionAtRequest) {
        return;
      }
      setProjectPathState(state.currentProjectPath);
      setBootstrapIssue(state.bootstrapIssue);
    });
  }, [launcherService]);

  const setProjectPath = useCallback((path: string) => {
    selectionVersionRef.current += 1;
    setProjectPathState(path);
    launcherService.setProjectPath(path);
  }, [launcherService]);

  const selectProjectPath = useCallback(async (path: string) => {
    selectionVersionRef.current += 1;
    const result = await launcherService.requestProjectSelection(path);
    if (result.accepted) {
      setProjectPathState(result.currentProjectPath);
      setBootstrapIssue(null);
    }
    return result;
  }, [launcherService]);

  const setLauncherProfile = useCallback((profile: string) => {
    setLauncherProfileState(profile);
    launcherService.setLauncherProfile(profile);
  }, [launcherService]);

  const value = useMemo(
    () => ({
      projectPath,
      launcherProfile,
      setProjectPath,
      selectProjectPath,
      setLauncherProfile,
      bootstrapIssue,
    }),
    [
      bootstrapIssue,
      launcherProfile,
      projectPath,
      selectProjectPath,
      setLauncherProfile,
      setProjectPath,
    ]
  );

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

/**
 * Accesses the current project context.
 *
 * @returns The current ProjectContextValue containing `projectPath`, `launcherProfile`, and the corresponding setter functions.
 * @throws Error if called outside of a `ProjectProvider` (message: "useProjectContext must be used within ProjectProvider").
 */
export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectContext must be used within ProjectProvider");
  }
  return ctx;
}
