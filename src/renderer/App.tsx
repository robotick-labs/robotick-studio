import React, { useEffect, useMemo, useRef } from "react";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { AppHeader } from "./components/header/AppHeader";
import { GenericDialog } from "./components/dialog/GenericDialog";
import {
  Launcher,
  Project,
  ProjectData,
  LauncherServiceProvider,
  launcherService,
} from "./data-sources/launcher";
import {
  getTelemetryDiagnostics,
  resetTelemetryStore,
  TelemetryServiceProvider,
  telemetryService,
  useTelemetryService,
} from "./data-sources/telemetry";
import { AppConfigProvider } from "./services/AppConfigService";
import {
  EditorRegistryProvider,
  type EditorRegistryBootstrapState,
} from "./services/EditorRegistry";
import { AppRoutes } from "./Router";
import styles from "./styles/App.module.css";
import { ContextMenuProvider } from "./components/context-menu/ContextMenuProvider";
import {
  publishRendererDiagnosticsPatch,
  resetProjectScopedRendererDiagnostics,
} from "./services/studio-diagnostics";
import { getLauncherRendererDiagnosticsSnapshot } from "./data-sources/launcher/internal/launcher-interface";

type RouterSelectionOptions = {
  isStandaloneApp?: boolean;
  locationProtocol?: string;
  isElectronRuntime?: boolean;
  isVsCodeWebview?: boolean;
};

const DEV_USER_TIMING_CLEAR_INTERVAL_MS = 3_000;
const DEV_USER_TIMING_ENTRY_THRESHOLD = 1_000;
const useProjectContext = Project.Context.use;
const useProjectData = ProjectData.use;

function shouldInstallDevUserTimingGuard(): boolean {
  return import.meta.env.DEV && typeof performance !== "undefined";
}

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
      /\bvscode\b/i.test(userAgent));
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

export function App({
  initialEditorRegistryState = null,
}: {
  initialEditorRegistryState?: EditorRegistryBootstrapState | null;
}) {
  const RouterComponent = useMemo(() => selectRouterComponent(), []);

  useEffect(() => {
    if (!shouldInstallDevUserTimingGuard()) {
      return;
    }

    const clearUserTimingEntries = () => {
      const measureCount = performance.getEntriesByType("measure").length;
      const markCount = performance.getEntriesByType("mark").length;
      if (
        measureCount < DEV_USER_TIMING_ENTRY_THRESHOLD &&
        markCount < DEV_USER_TIMING_ENTRY_THRESHOLD
      ) {
        return;
      }
      performance.clearMeasures();
      performance.clearMarks();
    };

    clearUserTimingEntries();
    const intervalId = window.setInterval(
      clearUserTimingEntries,
      DEV_USER_TIMING_CLEAR_INTERVAL_MS
    );
    return () => {
      window.clearInterval(intervalId);
      clearUserTimingEntries();
    };
  }, []);

  return (
    <TelemetryServiceProvider service={telemetryService}>
      <LauncherServiceProvider service={launcherService}>
        <Project.Context.Provider>
          <ProjectData.Provider>
            <AppConfigProvider>
              <EditorRegistryProvider
                initialBootstrapState={initialEditorRegistryState}
              >
                <Launcher.Context.Provider>
                  <ContextMenuProvider>
                    <RouterComponent>
                      <div className={styles.appShell}>
                        <RendererDiagnosticsPublisher />
                        <AppHeader />
                        <main className={styles.pageContainer}>
                          <AppRoutes />
                        </main>
                        <ProjectBootstrapIssueDialog />
                      </div>
                    </RouterComponent>
                  </ContextMenuProvider>
                </Launcher.Context.Provider>
              </EditorRegistryProvider>
            </AppConfigProvider>
          </ProjectData.Provider>
        </Project.Context.Provider>
      </LauncherServiceProvider>
    </TelemetryServiceProvider>
  );
}

function ProjectBootstrapIssueDialog() {
  const { bootstrapIssue, projectPath } = useProjectContext();
  const [dismissedKey, setDismissedKey] = React.useState<string | null>(null);
  const issueKey = bootstrapIssue
    ? `${bootstrapIssue.projectPath}:${bootstrapIssue.message}`
    : null;

  useEffect(() => {
    if (!issueKey || projectPath) {
      setDismissedKey(null);
    }
  }, [issueKey, projectPath]);

  if (!bootstrapIssue || issueKey === dismissedKey) {
    return null;
  }

  return (
    <GenericDialog
      title={
        bootstrapIssue.type === "locked"
          ? "Startup project unavailable"
          : "Startup project failed"
      }
      message={
        <>
          {bootstrapIssue.message}
          {bootstrapIssue.pid ? (
            <>
              <br />
              Owner PID: <code>{bootstrapIssue.pid}</code>
            </>
          ) : null}
        </>
      }
      onClose={() => setDismissedKey(issueKey)}
      actions={[
        {
          label: "Okay",
          onClick: () => setDismissedKey(issueKey),
          variant: "primary",
          autoFocus: true,
        },
      ]}
    />
  );
}

function RendererDiagnosticsPublisher() {
  const { projectPath } = useProjectContext();
  const { projectModels } = useProjectData();
  const telemetry = useTelemetryService();
  const lastProjectPathRef = useRef<string | null>(null);

  useEffect(() => {
    const normalizedProjectPath = projectPath.trim();
    if (lastProjectPathRef.current === normalizedProjectPath) {
      return;
    }
    lastProjectPathRef.current = normalizedProjectPath;
    resetTelemetryStore();
    resetProjectScopedRendererDiagnostics(normalizedProjectPath);
  }, [projectPath]);

  useEffect(() => {
    const publish = () =>
      publishRendererDiagnosticsPatch({
        launcher: getLauncherRendererDiagnosticsSnapshot(),
        telemetry: {
          loading: projectModels.loading,
          error: projectModels.error,
          model_count: projectModels.data.length,
          models: projectModels.data.map((model) => ({
            ...(() => {
              const diagnostics = getTelemetryDiagnostics(model.telemetryBaseUrl);
              return {
                subscriber_count: diagnostics.subscriberCount,
                last_frame_at: diagnostics.lastFrameAt,
                layout_loaded: diagnostics.layoutLoaded,
                last_error: diagnostics.lastErrorMessage,
              };
            })(),
            model_id: model.modelShortName || model.modelPath,
            telemetry_base_url: model.telemetryBaseUrl,
            ingress_rate_hz: telemetry.getIngressRateHz(model.telemetryBaseUrl),
            has_latest_model:
              telemetry.getLatestModel(model.telemetryBaseUrl) !== null,
          })),
        },
      });

    publish();
    const intervalId = window.setInterval(publish, 2000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [projectModels.data, projectModels.error, projectModels.loading, telemetry]);

  return null;
}
