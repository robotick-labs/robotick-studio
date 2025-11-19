import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { WorkspaceConfig } from "./services/AppConfigService";
import { WorkspacesConfig } from "./services/AppConfigService";
import { WorkspaceView } from "./components/workspaces/WorkspaceView";

export const resolvedWorkspaces = WorkspacesConfig;

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
  return (
    <div className="not-found">
      <h2>Page not found</h2>
      <p>We could not find that view.</p>
    </div>
  );
}
