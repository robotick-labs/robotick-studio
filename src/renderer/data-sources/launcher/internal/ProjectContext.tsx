import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import currentProject from "./launcher-interface";

export type ProjectContextValue = {
  projectPath: string;
  launcherProfile: string;
  setProjectPath: (path: string) => void;
  setLauncherProfile: (profile: string) => void;
};

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projectPath, setProjectPathState] = useState(
    () => currentProject.getProjectPath() ?? ""
  );
  const [launcherProfile, setLauncherProfileState] = useState(
    () => currentProject.getLauncherProfile() ?? "local:ALL"
  );

  useEffect(() => currentProject.onProjectChanged(setProjectPathState), []);
  useEffect(
    () =>
      currentProject.onLauncherProfileChanged(setLauncherProfileState),
    []
  );

  const setProjectPath = useCallback((path: string) => {
    setProjectPathState(path);
    currentProject.setProjectPath(path);
  }, []);

  const setLauncherProfile = useCallback((profile: string) => {
    setLauncherProfileState(profile);
    currentProject.setLauncherProfile(profile);
  }, []);

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
