import React from "react";
import { BrowserRouter } from "react-router-dom";
import { AppHeader } from "./components/header/AppHeader";
import {
  Launcher,
  Project,
  ProjectData,
  LauncherServiceProvider,
  launcherService,
} from "./data-sources/launcher";
import {
  TelemetryServiceProvider,
  telemetryService,
} from "./data-sources/telemetry";
import { AppRoutes } from "./Router";
import styles from "./styles/App.module.css";

export function App() {
  return (
    <TelemetryServiceProvider service={telemetryService}>
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
    </TelemetryServiceProvider>
  );
}
