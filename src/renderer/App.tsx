import React from "react";
import { BrowserRouter } from "react-router-dom";
import { AppHeader } from "./components/header/AppHeader";
import { LauncherProvider } from "./core/LauncherContext";
import { ProjectProvider } from "./core/ProjectContext";
import { LauncherDataProvider } from "./core/LauncherDataContext";
import { AppRoutes } from "./Router";
import styles from "./styles/App/App.module.css";

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
