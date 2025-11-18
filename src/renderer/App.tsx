import React from "react";
import { BrowserRouter } from "react-router-dom";
import { AppHeader } from "./components/header/AppHeader";
import { LauncherProvider } from "./core/launcher-context";
import { ProjectProvider } from "./core/project-context";
import { AppRoutes } from "./router";
import styles from "./App.module.css";

export function App() {
  return (
    <ProjectProvider>
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
    </ProjectProvider>
  );
}
