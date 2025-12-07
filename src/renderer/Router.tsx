import React from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { WorkspaceConfig } from "./services/AppConfigService";
import { WorkspacesConfig } from "./services/AppConfigService";
import { WorkspaceView } from "./components/workspaces/WorkspaceView";
import { reportViewDiagnostics } from "./utils/viewDiagnostics";

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
    <Routes>
      <Route
        path="/"
        element={
          <Navigate
            to={(resolvedWorkspaces[0] && resolvedWorkspaces[0].path) || "/home"}
            replace
          />
        }
      />
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
  );
}

function WorkspaceFallback() {
  return <div className="workspace-loading">Loading…</div>;
}

function NotFound() {
  const location = useLocation();
  const fallbackHome =
    (resolvedWorkspaces[0] && resolvedWorkspaces[0].path) || "/home";
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
