// router.tsx
// -------------------------------------------------------------
// Robotick Hub — Dynamic React Router
//
// This router:
//
//   ✓ Discovers all page entrypoints dynamically (import.meta.glob)
//   ✓ Each page must export a default React component
//   ✓ No legacy JS init/uninit
//   ✓ No HTML templates
//   ✓ No static route table
//
// This is effectively a plugin architecture for React pages.
//
// Directory structure example:
//   pages/models/models.tsx       → route /models
//   pages/telemetry/telemetry.tsx → route /telemetry
//   pages/home/home.tsx           → route /home
//
// -------------------------------------------------------------

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// Discover all TSX entrypoints in /pages/**/folderName.tsx
const pageModules = import.meta.glob("./pages/*/*.tsx");

// Build dynamic React routes
const dynamicRoutes = Object.entries(pageModules)
  .map(([path, loader]) => {
    //
    // Extract folder name and file name for the route:
    //
    //   "./pages/models/models.tsx"
    //     → folder = "models"
    //     → routePath = "/models"
    //
    const match = path.match(/\.\/pages\/([^/]+)\/([^/]+)\.tsx$/);
    if (!match) return null;

    const [_, folderName, fileName] = match;
    const route = "/" + folderName.toLowerCase();

    // Lazy load the component
    const Component = React.lazy(() => loader());

    return (
      <Route
        key={route}
        path={route}
        element={
          <React.Suspense fallback={<div>Loading...</div>}>
            <Component />
          </React.Suspense>
        }
      />
    );
  })
  .filter(Boolean);

export function mountRouter(app: HTMLElement) {
  const root = ReactDOM.createRoot(app);

  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <Routes>
          {/* Redirect plain root to /home if present */}
          <Route path="/" element={<Navigate to="/home" replace />} />

          {/* All dynamically discovered pages */}
          {dynamicRoutes}

          {/* 404 fallback */}
          <Route path="*" element={<div>Page not found</div>} />
        </Routes>
      </BrowserRouter>
    </React.StrictMode>
  );

  return root;
}
