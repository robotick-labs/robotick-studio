import React from "react";
import { BrowserRouter } from "react-router-dom";
import { AppHeader } from "./components/header/AppHeader";
import { Launcher, Project, ProjectData } from "./data-sources/launcher";

const ProjectProvider = Project.Context.Provider;
const LauncherProvider = Launcher.Context.Provider;
const LauncherDataProvider = ProjectData.Provider;
import { AppRoutes } from "./Router";
import styles from "./styles/App.module.css";

export function App() {
  return (
    <ProjectProvider>
      <LauncherDataProvider>
        <LauncherProvider>
          <BrowserRouter>
            <div className={styles.appShell}>
              <AppHeader />
              <main className={styles.pageContainer}>
                <AppRoutes />
              </main>
            </div>
          </BrowserRouter>
        </LauncherProvider>
      </LauncherDataProvider>
    </ProjectProvider>
  );
}
