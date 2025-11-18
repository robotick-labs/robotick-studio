import React from "react";
import { BrowserRouter } from "react-router-dom";
import { AppHeader } from "./components/header/AppHeader";
import { LauncherProvider } from "./core/launcher-context";
import { ProjectProvider } from "./core/project-context";
import { AppRoutes } from "./router";

export function App() {
  return (
    <ProjectProvider>
      <LauncherProvider>
        <BrowserRouter>
          <div className="app-shell">
            <AppHeader />
            <main className="page-container">
              <AppRoutes />
            </main>
          </div>
        </BrowserRouter>
      </LauncherProvider>
    </ProjectProvider>
  );
}
