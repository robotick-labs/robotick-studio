import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { RouteConfig } from "./services/AppConfigService";
import { RoutesConfig } from "./services/AppConfigService";

type LazyComponent = React.LazyExoticComponent<
  React.ComponentType<Record<string, never>>
>;

type RouteEntry = RouteConfig & { Component: LazyComponent };

const moduleMap = import.meta.glob("./components/editors/**/*.tsx");

function createRouteEntries(): RouteEntry[] {
  return RoutesConfig.map((route) => {
    const loader = moduleMap[route.module];
    if (!loader) {
      throw new Error(
        `Route '${route.id}' references unknown module: ${route.module}`
      );
    }
    const Component = React.lazy(
      loader as () => Promise<{
        default: React.ComponentType<Record<string, never>>;
      }>
    );
    return { ...route, Component };
  });
}

export const resolvedRoutes = createRouteEntries();

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Navigate
            to={(resolvedRoutes[0] && resolvedRoutes[0].path) || "/home"}
            replace
          />
        }
      />
      {resolvedRoutes.map(({ path, id, Component }) => (
        <Route
          key={id}
          path={path}
          element={
            <React.Suspense fallback={<RouteFallback />}>
              <Component />
            </React.Suspense>
          }
        />
      ))}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function RouteFallback() {
  return <div className="route-loading">Loading…</div>;
}

function NotFound() {
  return (
    <div className="not-found">
      <h2>Page not found</h2>
      <p>We could not find that view.</p>
    </div>
  );
}
