import React from "react";
import { BrowserRouter } from "react-router-dom";
import { AppHeader } from "./components/header/AppHeader";
import { Launcher, Project, ProjectData } from "./data-sources/launcher";
import { AppRoutes } from "./Router";
import styles from "./styles/App.module.css";

export function App() {
  return (
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
  );
}
