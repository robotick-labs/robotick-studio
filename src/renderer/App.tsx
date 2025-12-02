import React, { useMemo } from "react";
import { BrowserRouter, HashRouter } from "react-router-dom";
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
import { AppConfigProvider } from "./services/AppConfigService";
import { AppRoutes } from "./Router";
import styles from "./styles/App.module.css";
import { ContextMenuProvider } from "./components/context-menu/ContextMenuProvider";

type RouterSelectionOptions = {
  isStandaloneApp?: boolean;
  locationProtocol?: string;
  isElectronRuntime?: boolean;
  isVsCodeWebview?: boolean;
};

export function selectRouterComponent(
  options: RouterSelectionOptions = {}
): typeof BrowserRouter | typeof HashRouter {
  const hasWindow = typeof window !== "undefined";
  const envStandalone =
    options.isStandaloneApp ??
    (hasWindow ? window.robotick?.environment?.isStandaloneApp : undefined);
  const protocol =
    options.locationProtocol ??
    (hasWindow ? window.location?.protocol : undefined);
  const userAgent =
    (typeof navigator !== "undefined" && navigator.userAgent) || "";
  const vsCodeWebview =
    options.isVsCodeWebview ??
    ((typeof protocol === "string" && protocol === "vscode-webview:") ||
      /\bVSCODE\b/i.test(userAgent) ||
      /\bVSCode\b/i.test(userAgent));
  const electronRuntime =
    options.isElectronRuntime ??
    (typeof process !== "undefined" &&
      typeof process.versions === "object" &&
      Boolean(process.versions?.electron));
  const shouldUseHash =
    Boolean(envStandalone) ||
    electronRuntime ||
    vsCodeWebview ||
    (typeof protocol === "string" && protocol === "file:");

  if (typeof console !== "undefined" && typeof console.info === "function") {
    console.info("[Robotick] Router selection", {
      standaloneFlag: Boolean(envStandalone),
      locationProtocol: protocol,
      electronRuntime,
      userAgent,
      vsCodeWebview,
      router: shouldUseHash ? "hash" : "browser",
    });
  }

  return shouldUseHash ? HashRouter : BrowserRouter;
}

export function App() {
  const RouterComponent = useMemo(() => selectRouterComponent(), []);
  return (
    <AppConfigProvider>
      <TelemetryServiceProvider service={telemetryService}>
        <LauncherServiceProvider service={launcherService}>
          <Project.Context.Provider>
            <ProjectData.Provider>
              <Launcher.Context.Provider>
                <ContextMenuProvider>
                  <RouterComponent>
                    <div className={styles.appShell}>
                      <AppHeader />
                      <main className={styles.pageContainer}>
                        <AppRoutes />
                      </main>
                    </div>
                  </RouterComponent>
                </ContextMenuProvider>
              </Launcher.Context.Provider>
            </ProjectData.Provider>
          </Project.Context.Provider>
        </LauncherServiceProvider>
      </TelemetryServiceProvider>
    </AppConfigProvider>
  );
}
