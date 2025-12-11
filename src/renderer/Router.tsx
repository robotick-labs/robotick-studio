import React from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { WorkspaceConfig } from "./services/AppConfigService";
import { WorkspacesConfig } from "./services/AppConfigService";
import { WorkspaceView } from "./components/workspaces/WorkspaceView";
import { reportViewDiagnostics } from "./utils/viewDiagnostics";
import { useProjectContext } from "./data-sources/launcher/internal/ProjectContext";
import { loadRememberedWorkspacePath } from "./utils/workspaceMemory";

export const resolvedWorkspaces = WorkspacesConfig;

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
      <ProjectWorkspaceSync />
      <Routes>
        <Route path="/" element={<DefaultWorkspaceRedirect />} />
        {resolvedWorkspaces.map((workspace) => (
          <Route
            key={workspace.id}
            path={workspace.path}
            element={
              <React.Suspense fallback={<WorkspaceFallback />}>
                <WorkspaceView workspace={workspace} />
              </React.Suspense>
            }
          />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

function WorkspaceFallback() {
  return <div className="workspace-loading">Loading…</div>;
}

function NotFound() {
  const location = useLocation();
  const fallbackHome = getFallbackWorkspacePath();
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

function getFallbackWorkspacePath(): string {
  return resolvedWorkspaces[0]?.path ?? "/home";
}

function resolveRememberedWorkspace(projectPath: string | undefined): string {
  const remembered = loadRememberedWorkspacePath(projectPath);
  if (
    remembered &&
    resolvedWorkspaces.some((workspace) => workspace.path === remembered)
  ) {
    return remembered;
  }
  return getFallbackWorkspacePath();
}

function DefaultWorkspaceRedirect() {
  const { projectPath } = useProjectContext();
  const target = resolveRememberedWorkspace(projectPath);
  return <Navigate to={target} replace />;
}

/**
 * Synchronizes the current route to the remembered workspace for the active project when the project changes.
 *
 * Reads the active project from project context and, if it differs from the previous project, resolves the remembered workspace path for that project and navigates to it using a replace navigation when the current pathname is different.
 */
function ProjectWorkspaceSync() {
  const { projectPath } = useProjectContext();
  const location = useLocation();
  const navigate = useNavigate();
  const previousProject = React.useRef<string | undefined>(undefined);

  React.useEffect(() => {
    if (previousProject.current === projectPath) {
      return;
    }
    previousProject.current = projectPath;
    const target = resolveRememberedWorkspace(projectPath);
    if (location.pathname !== target) {
      navigate(target, { replace: true });
    }
  }, [projectPath, location.pathname, navigate]);

  return null;
}