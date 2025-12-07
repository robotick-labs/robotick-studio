import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLauncherService } from "./LauncherService";

export type ProjectContextValue = {
  projectPath: string;
  launcherProfile: string;
  setProjectPath: (path: string) => void;
  setLauncherProfile: (profile: string) => void;
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

  useEffect(
    () => launcherService.onProjectChanged(setProjectPathState),
    [launcherService]
  );
  useEffect(
    () => launcherService.onLauncherProfileChanged(setLauncherProfileState),
    [launcherService]
  );

  const setProjectPath = useCallback((path: string) => {
    setProjectPathState(path);
    launcherService.setProjectPath(path);
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
      setLauncherProfile,
    }),
    [launcherProfile, projectPath, setLauncherProfile, setProjectPath]
  );

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectContext must be used within ProjectProvider");
  }
  return ctx;
}

export type { ProjectContextValue };
