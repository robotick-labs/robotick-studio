import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { WorkspaceConfig } from "./services/AppConfigService";
import { WorkspacesConfig } from "./services/AppConfigService";

type LazyComponent = React.LazyExoticComponent<
  React.ComponentType<Record<string, never>>
>;

type WorkspaceEntry = WorkspaceConfig & { Component: LazyComponent };

const moduleMap = import.meta.glob("./components/editors/**/*.tsx");

function createWorkspaceEntries(): WorkspaceEntry[] {
  return WorkspacesConfig.map((workspace) => {
    const loader = moduleMap[workspace.module];
    if (!loader) {
      throw new Error(
        `Workspace '${workspace.id}' references unknown module: ${workspace.module}`
      );
    }
    const Component = React.lazy(
      loader as () => Promise<{
        default: React.ComponentType<Record<string, never>>;
      }>
    );
    return { ...workspace, Component };
  });
}

export const resolvedWorkspaces = createWorkspaceEntries();

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
      {resolvedWorkspaces.map(({ path, id, Component }) => (
        <Route
          key={id}
          path={path}
          element={
            <React.Suspense fallback={<WorkspaceFallback />}>
              <Component />
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
