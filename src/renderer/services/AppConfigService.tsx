import React, { createContext, useContext } from "react";
import routesSource from "../config/app-routes.yaml?raw";

type RouteGroup = "project-select" | "dev" | "test" | "help";

export type RouteConfig = {
  id: string;
  path: string;
  label: string;
  group: RouteGroup;
  module: string;
};

export type AppConfig = {
  routes: RouteConfig[];
};

function parseValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseYamlRoutes(raw: string): RouteConfig[] {
  const routes: RouteConfig[] = [];
  let current: Partial<RouteConfig> | null = null;
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed === "routes:") continue;

    if (trimmed.startsWith("-")) {
      if (current) routes.push(current as RouteConfig);
      current = {};
      const remainder = trimmed.slice(1).trim();
      if (remainder) {
        const [key, value] = remainder.split(/:(.+)/);
        if (key && value !== undefined) {
          (current as any)[key.trim()] = parseValue(value);
        }
      }
      continue;
    }

    if (!current) {
      throw new Error("Malformed routes configuration");
    }

    const [key, value] = trimmed.split(/:(.+)/);
    if (!key || value === undefined) continue;
    (current as any)[key.trim()] = parseValue(value);
  }

  if (current) {
    routes.push(current as RouteConfig);
  }

  return routes.map((route) => {
    const required: (keyof RouteConfig)[] = [
      "id",
      "path",
      "label",
      "group",
      "module",
    ];
    for (const key of required) {
      if (!route[key]) {
        throw new Error(`Route '${route.id ?? "unknown"}' missing ${key}`);
      }
    }
    return route as RouteConfig;
  });
}

function loadConfig(): AppConfig {
  const routes = parseYamlRoutes(routesSource);
  return { routes };
}

const config = loadConfig();

const AppConfigContext = createContext<AppConfig>(config);

export function AppConfigProvider({ children }: { children: React.ReactNode }) {
  return (
    <AppConfigContext.Provider value={config}>
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig(): AppConfig {
  return useContext(AppConfigContext);
}

export const RoutesConfig = config.routes;
