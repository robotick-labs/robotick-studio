import React from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { WorkbenchConfig } from "./services/AppConfigService";
import { WorkbenchesConfig } from "./services/AppConfigService";
import { WorkbenchView } from "./components/workbenches/WorkbenchView";
import { reportViewDiagnostics } from "./utils/viewDiagnostics";
import { useProjectContext } from "./data-sources/launcher/internal/ProjectContext";
import { loadRememberedWorkbenchPath } from "./utils/workbenchMemory";
import {
  getWindowScope,
  isPrimaryWindowSession,
} from "./utils/windowSession";

export const resolvedWorkbenches = WorkbenchesConfig;

export function shouldForceHomeRedirect(
  pathname: string,
  protocol?: string
): boolean {
  if (protocol === "file:") return true;
  return pathname.includes(".html");
}

export function AppRoutes() {
  return (
    <>
      <ProjectWorkbenchSync />
      <Routes>
        <Route path="/" element={<DefaultWorkbenchRedirect />} />
        {resolvedWorkbenches.map((workbench) => (
          <Route
            key={workbench.id}
            path={workbench.path}
            element={
              <React.Suspense fallback={<WorkbenchFallback />}>
                <WorkbenchView workbench={workbench} />
              </React.Suspense>
            }
          />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

function WorkbenchFallback() {
  return <div className="workbench-loading">Loading…</div>;
}

function NotFound() {
  const location = useLocation();
  const fallbackHome = getFallbackWorkbenchPath();
  const protocol =
    typeof window !== "undefined" ? window.location.protocol : undefined;
  const shouldForceHome = shouldForceHomeRedirect(location.pathname, protocol);

  React.useEffect(() => {
    reportViewDiagnostics("not-found", {
      pathname: location.pathname,
      search: location.search,
      forcedRedirect: shouldForceHome,
    });
  }, [location.pathname, location.search, shouldForceHome]);

  if (shouldForceHome) {
    return <Navigate to={fallbackHome} replace />;
  }

  return (
    <div className="not-found">
      <h2>Page not found</h2>
      <p>We could not find that view.</p>
    </div>
  );
}

function getFallbackWorkbenchPath(): string {
  return resolvedWorkbenches[0]?.path ?? "/home";
}

function resolveRememberedWorkbench(projectPath: string | undefined): string {
  const remembered = loadRememberedWorkbenchPath(projectPath, {
    windowScope: getWindowScope(),
    isPrimaryWindow: isPrimaryWindowSession(),
  });
  if (
    remembered &&
    resolvedWorkbenches.some((workbench) => workbench.path === remembered)
  ) {
    return remembered;
  }
  return getFallbackWorkbenchPath();
}

function DefaultWorkbenchRedirect() {
  const { projectPath } = useProjectContext();
  const target = resolveRememberedWorkbench(projectPath);
  return <Navigate to={target} replace />;
}

/**
 * Synchronizes the current route to the remembered workbench for the active project when the project changes.
 *
 * Reads the active project from project context and, if it differs from the previous project, resolves the remembered workbench path for that project and navigates to it using a replace navigation when the current pathname is different.
 */
function ProjectWorkbenchSync() {
  const { projectPath } = useProjectContext();
  const location = useLocation();
  const navigate = useNavigate();
  const previousProject = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    if (previousProject.current === projectPath) {
      return;
    }
    previousProject.current = projectPath;
    const target = resolveRememberedWorkbench(projectPath);
    if (location.pathname !== target) {
      navigate(target, { replace: true });
    }
  }, [projectPath, location.pathname, navigate]);

  return null;
}
