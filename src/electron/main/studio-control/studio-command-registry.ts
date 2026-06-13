import type { StudioControlCommandDescriptor } from "../../common/studio-control-contract";
import type {
  StudioControlRouteDependencies,
} from "./studio-control-routes";
import {
  getStudioDiagnosticsConsole,
  getStudioDiagnosticsCssQuery,
  getStudioDiagnosticsDomQuery,
  getStudioDiagnosticsDomSummary,
  getStudioDiagnosticsEndpoints,
  getStudioDiagnosticsFetchCheck,
  getStudioDiagnosticsRenderer,
  getStudioDiagnosticsScreenshot,
  getStudioDiagnosticsSnapshot,
  getStudioDiagnosticsStatus,
  getStudioDiagnosticsTelemetry,
} from "./studio-diagnostics";
import {
  getStudioRuntimeFocused,
  getStudioRuntimeStatus,
} from "./studio-runtime-snapshot";

type StudioControlCommandResult = {
  statusCode: number;
  payload: unknown;
};

type StudioControlCommandMatch = {
  commandId: string;
  params: Record<string, unknown>;
};

type StudioControlCommandHandler = (
  params: Record<string, unknown>,
  dependencies: StudioControlRouteDependencies,
  body: unknown
) => Promise<StudioControlCommandResult>;

type StudioControlRegisteredCommand = StudioControlCommandDescriptor & {
  match: (
    method: string,
    pathname: string,
    searchParams: URLSearchParams
  ) => StudioControlCommandMatch | null;
  execute: StudioControlCommandHandler;
};

function decodePathSegments(resourcePath: string): string[] | null {
  try {
    return resourcePath
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function resourcePathParam(value: unknown): string[] | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return decodePathSegments(value.trim().replace(/^\/+/, ""));
}

function waitForMs(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, Math.min(5000, ms)));
}

function screenshotSettleMs(params: Record<string, unknown>): number {
  if (typeof params.wait_ms === "string") {
    const parsed = Number.parseInt(params.wait_ms, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (params.wait_for_render === "1" || params.wait_for_render === "true") {
    return 250;
  }
  if (params.wait_for_telemetry === "1" || params.wait_for_telemetry === "true") {
    return 500;
  }
  return 0;
}

function statusPathSegments(pathname: string): string[] | null {
  if (pathname === "/v1/status" || pathname === "/v1/studio/status") {
    return [];
  }
  const prefix = "/v1/studio/";
  const suffix = "/status";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    return null;
  }
  return decodePathSegments(pathname.slice(prefix.length, -suffix.length));
}

function activationPathSegments(pathname: string): string[] | null {
  if (pathname === "/v1/activate" || pathname === "/v1/studio/activate") {
    return [];
  }
  const prefix = "/v1/studio/";
  const suffix = "/activate";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    return null;
  }
  return decodePathSegments(pathname.slice(prefix.length, -suffix.length));
}

function diagnosticsKind(
  pathname: string
):
  | "status"
  | "endpoints"
  | "renderer"
  | "console"
  | "fetch-check"
  | "telemetry"
  | "dom-summary"
  | "dom-query"
  | "css-query"
  | "screenshot"
  | "snapshot"
  | null {
  if (
    pathname === "/v1/diagnostics/status" ||
    pathname === "/v1/studio/diagnostics/status"
  ) {
    return "status";
  }
  if (
    pathname === "/v1/diagnostics/endpoints" ||
    pathname === "/v1/studio/diagnostics/endpoints"
  ) {
    return "endpoints";
  }
  if (
    pathname === "/v1/diagnostics/renderer" ||
    pathname === "/v1/studio/diagnostics/renderer"
  ) {
    return "renderer";
  }
  if (
    pathname === "/v1/diagnostics/console" ||
    pathname === "/v1/studio/diagnostics/console"
  ) {
    return "console";
  }
  if (
    pathname === "/v1/diagnostics/fetch-check" ||
    pathname === "/v1/studio/diagnostics/fetch-check"
  ) {
    return "fetch-check";
  }
  if (
    pathname === "/v1/diagnostics/telemetry" ||
    pathname === "/v1/studio/diagnostics/telemetry"
  ) {
    return "telemetry";
  }
  if (
    pathname === "/v1/diagnostics/dom/summary" ||
    pathname === "/v1/studio/diagnostics/dom/summary"
  ) {
    return "dom-summary";
  }
  if (
    pathname === "/v1/diagnostics/dom/query" ||
    pathname === "/v1/studio/diagnostics/dom/query"
  ) {
    return "dom-query";
  }
  if (
    pathname === "/v1/diagnostics/css/query" ||
    pathname === "/v1/studio/diagnostics/css/query"
  ) {
    return "css-query";
  }
  if (
    pathname === "/v1/diagnostics/screenshot" ||
    pathname === "/v1/studio/diagnostics/screenshot"
  ) {
    return "screenshot";
  }
  if (
    pathname === "/v1/diagnostics/snapshot" ||
    pathname === "/v1/studio/diagnostics/snapshot"
  ) {
    return "snapshot";
  }
  return null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function buildCommandRegistry(): StudioControlRegisteredCommand[] {
  const focusedCommandId = "studio.focused";
  const resourceStatusCommandId = "studio.resource.status";
  const resourceActivateCommandId = "studio.resource.activate";
  const projectSelectCommandId = "studio.project.select";
  return [
    {
      id: focusedCommandId,
      title: "Focused Studio Context",
      description: "Return the currently focused Studio window, workbench, layout, and panel.",
      provider: "electron_main",
      input_schema: { type: "object", properties: {} },
      output_schema: { type: "object", properties: { resource_type: { const: "robotick_studio_focused" } } },
      availability: {
        requires_live_instance: true,
        requires_renderer: false,
        resource_scope: "instance",
      },
      read_only: true,
      destructive: false,
      match(method, pathname) {
        if (
          method === "GET" &&
          (pathname === "/v1/focused" || pathname === "/v1/studio/focused")
        ) {
          return { commandId: focusedCommandId, params: {} };
        }
        return null;
      },
      async execute(_params, dependencies) {
        return {
          statusCode: 200,
          payload: await getStudioRuntimeFocused(dependencies.snapshotProvider),
        };
      },
    },
    {
      id: resourceStatusCommandId,
      title: "Studio Resource Status",
      description: "Return Studio runtime status for the current instance or a resource path.",
      provider: "electron_main",
      input_schema: {
        type: "object",
        properties: {
          path_segments: { type: "array", items: { type: "string" } },
        },
      },
      output_schema: { type: "object" },
      availability: {
        requires_live_instance: true,
        requires_renderer: false,
        resource_scope: "resource",
      },
      read_only: true,
      destructive: false,
      match(method, pathname) {
        if (method !== "GET") {
          return null;
        }
        const segments = statusPathSegments(pathname);
        if (segments === null) {
          return null;
        }
        return { commandId: resourceStatusCommandId, params: { path_segments: segments } };
      },
      async execute(params, dependencies) {
        const pathSegments = isStringArray(params.path_segments)
          ? params.path_segments
          : [];
        const payload = await getStudioRuntimeStatus(
          dependencies.snapshotProvider,
          pathSegments
        );
        if (!payload) {
          return { statusCode: 404, payload: { error: "studio_resource_not_found" } };
        }
        return { statusCode: 200, payload };
      },
    },
    {
      id: resourceActivateCommandId,
      title: "Activate Studio Resource",
      description: "Activate the requested Studio resource path.",
      provider: "electron_main",
      input_schema: {
        type: "object",
        properties: {
          path_segments: { type: "array", items: { type: "string" } },
        },
      },
      output_schema: { type: "object" },
      availability: {
        requires_live_instance: true,
        requires_renderer: false,
        resource_scope: "resource",
      },
      read_only: false,
      destructive: false,
      match(method, pathname) {
        if (method !== "POST") {
          return null;
        }
        const segments = activationPathSegments(pathname);
        if (segments === null) {
          return null;
        }
        return {
          commandId: resourceActivateCommandId,
          params: { path_segments: segments },
        };
      },
      async execute(params, dependencies) {
        const pathSegments = isStringArray(params.path_segments)
          ? params.path_segments
          : [];
        const status = await getStudioRuntimeStatus(
          dependencies.snapshotProvider,
          pathSegments
        );
        if (!status) {
          return {
            statusCode: 404,
            payload: {
              error: {
                code: "studio_resource_not_found",
                message: "Studio resource not found.",
              },
            },
          };
        }
        const targetPath = isStringArray(status.activation_target_path)
          ? status.activation_target_path
          : null;
        if (!targetPath || targetPath.length === 0) {
          return {
            statusCode: 400,
            payload: {
              error: {
                code: "studio_activation_unsupported",
                message: "No activatable Studio resource is available from this context.",
                recovery:
                  "Use `cd` to inspect a window, workbench, layout, or panel, then run `activate`.",
              },
            },
          };
        }
        const targetStatus = await getStudioRuntimeStatus(
          dependencies.snapshotProvider,
          targetPath
        );
        const result = dependencies.activateResource(
          targetPath,
          targetStatus?.active === true
        );
        return {
          statusCode: result.accepted ? 200 : 409,
          payload: result,
        };
      },
    },
    {
      id: projectSelectCommandId,
      title: "Select Studio Project",
      description: "Select the current Studio project.",
      provider: "electron_main",
      input_schema: {
        type: "object",
        required: ["project_path"],
        properties: {
          project_path: { type: "string" },
        },
      },
      output_schema: { type: "object" },
      availability: {
        requires_live_instance: true,
        requires_renderer: false,
        resource_scope: "project",
      },
      read_only: false,
      destructive: false,
      match(method, pathname) {
        if (method === "POST" && pathname === "/v1/project/select") {
          return { commandId: projectSelectCommandId, params: {} };
        }
        return null;
      },
      async execute(_params, dependencies, body) {
        const projectPath =
          body &&
          typeof body === "object" &&
          typeof (body as { project_path?: unknown }).project_path === "string"
            ? (body as { project_path: string }).project_path.trim()
            : "";
        const result = dependencies.selectProject(projectPath);
        return {
          statusCode: result.accepted ? 200 : 409,
          payload: result,
        };
      },
    },
    ...(["status", "endpoints", "renderer", "console", "fetch-check", "telemetry", "dom-summary", "dom-query", "css-query", "screenshot", "snapshot"] as const).map(
      (kind) => {
        const commandId = `studio.diagnostics.${kind}`;
        return {
          id: commandId,
          title: `Studio Diagnostics ${kind}`,
          description: `Return Studio diagnostics for ${kind}.`,
          provider: "electron_main",
          input_schema: { type: "object", properties: {} },
          output_schema: { type: "object" },
          availability: {
            requires_live_instance: true,
            requires_renderer:
              kind === "renderer" ||
              kind === "console" ||
              kind === "fetch-check" ||
              kind === "telemetry" ||
              kind === "dom-summary" ||
              kind === "dom-query" ||
              kind === "css-query" ||
              kind === "snapshot" ||
              kind === "screenshot",
            resource_scope: "diagnostics",
          },
          read_only: true,
          destructive: false,
          match(method: string, pathname: string, searchParams: URLSearchParams) {
            if (method !== "GET" || diagnosticsKind(pathname) !== kind) {
              return null;
            }
            return { commandId, params: Object.fromEntries(searchParams.entries()) };
          },
          async execute(params: Record<string, unknown>, dependencies: StudioControlRouteDependencies) {
            const payload =
              kind === "status"
                ? await getStudioDiagnosticsStatus(dependencies.diagnosticsProvider)
                : kind === "endpoints"
                  ? await getStudioDiagnosticsEndpoints(dependencies.diagnosticsProvider)
                  : kind === "renderer"
                    ? await getStudioDiagnosticsRenderer(dependencies.diagnosticsProvider)
                    : kind === "console"
                      ? await getStudioDiagnosticsConsole(dependencies.diagnosticsProvider)
                      : kind === "fetch-check"
                        ? await getStudioDiagnosticsFetchCheck(dependencies.diagnosticsProvider)
                        : kind === "telemetry"
                          ? await getStudioDiagnosticsTelemetry(dependencies.diagnosticsProvider)
                          : kind === "dom-summary"
                            ? await getStudioDiagnosticsDomSummary(dependencies.diagnosticsProvider, params)
                            : kind === "dom-query"
                              ? await getStudioDiagnosticsDomQuery(dependencies.diagnosticsProvider, params)
                              : kind === "css-query"
                                ? await getStudioDiagnosticsCssQuery(dependencies.diagnosticsProvider, params)
                                : kind === "snapshot"
                                  ? await getStudioDiagnosticsSnapshot(dependencies.diagnosticsProvider)
                                  : await (async () => {
                                    const resourcePath = resourcePathParam(params.resource_path);
                                    if (resourcePath) {
                                      dependencies.activateResource(resourcePath, false);
                                    }
                                    await waitForMs(screenshotSettleMs(params));
                                    return await getStudioDiagnosticsScreenshot(dependencies.diagnosticsProvider, params);
                                  })();
            return { statusCode: payload ? 200 : 503, payload: payload ?? { error: "diagnostics_unavailable" } };
          },
        } satisfies StudioControlRegisteredCommand;
      }
    ),
  ];
}

const COMMAND_REGISTRY = buildCommandRegistry();

export function listStudioControlCommands(): StudioControlCommandDescriptor[] {
  return COMMAND_REGISTRY.map((command) => ({
    id: command.id,
    title: command.title,
    description: command.description,
    provider: command.provider,
    input_schema: command.input_schema,
    output_schema: command.output_schema,
    availability: command.availability,
    read_only: command.read_only,
    destructive: command.destructive,
  }));
}

export async function dispatchStudioControlCommand(
  method: string,
  pathname: string,
  dependencies: StudioControlRouteDependencies,
  body: unknown
): Promise<StudioControlCommandResult | null> {
  const url = new URL(pathname, "http://127.0.0.1");
  for (const command of COMMAND_REGISTRY) {
    const matched = command.match(method, url.pathname, url.searchParams);
    if (!matched) {
      continue;
    }
    return command.execute(matched.params, dependencies, body);
  }
  return null;
}
