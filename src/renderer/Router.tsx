import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

type LazyComponent = React.LazyExoticComponent<
  React.ComponentType<Record<string, never>>
>;

const HomePage = React.lazy(() => import("./pages/home/HomePage"));
const HelpPage = React.lazy(() => import("./pages/help/HelpPage"));
const ModelsPage = React.lazy(() => import("./pages/models/ModelsPage"));
const ProjectPage = React.lazy(() => import("./pages/project/ProjectPage"));
const RemoteControlPage = React.lazy(
  () => import("./pages/remote-control/RemoteControlPage")
);
const TelemetryPage = React.lazy(() => import("./pages/telemetry/TelemetryPage"));
const TerminalPage = React.lazy(() => import("./pages/terminal/TerminalPage"));

const routeConfig: { path: string; Component: LazyComponent }[] = [
  { path: "/home", Component: HomePage },
  { path: "/help", Component: HelpPage },
  { path: "/models", Component: ModelsPage },
  { path: "/project", Component: ProjectPage },
  { path: "/remote-control", Component: RemoteControlPage },
  { path: "/telemetry", Component: TelemetryPage },
  { path: "/terminal", Component: TerminalPage },
];

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      {routeConfig.map(({ path, Component }) => (
        <Route
          key={path}
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
