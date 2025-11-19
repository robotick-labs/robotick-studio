import React from "react";
import { BrowserRouter } from "react-router-dom";
import { AppHeader } from "./components/header/AppHeader";
import {
  Launcher,
  Project,
  ProjectData,
  LauncherServiceProvider,
  createLauncherService,
} from "./data-sources/launcher";
import { AppRoutes } from "./Router";
import styles from "./styles/App.module.css";

const launcherService = createLauncherService();

export function App() {
  return (
    <LauncherServiceProvider service={launcherService}>
      <Project.Context.Provider>
        <ProjectData.Provider>
          <Launcher.Context.Provider>
            <BrowserRouter>
              <div className={styles.appShell}>
                <AppHeader />
                <main className={styles.pageContainer}>
                  <AppRoutes />
                </main>
              </div>
            </BrowserRouter>
          </Launcher.Context.Provider>
        </ProjectData.Provider>
      </Project.Context.Provider>
    </LauncherServiceProvider>
  );
}
