import type { IncomingMessage, ServerResponse } from "http";
import type {
  StudioControlActivationResponse,
  StudioControlProjectSelectionRequest,
  StudioControlProjectSelectionResponse,
} from "../../common/studio-control-contract";
import type { StudioRuntimeSnapshotProvider } from "./studio-runtime-snapshot";
import {
  getStudioRuntimeFocused,
  getStudioRuntimeStatus,
} from "./studio-runtime-snapshot";

export type StudioControlRouteDependencies = {
  snapshotProvider: StudioRuntimeSnapshotProvider;
  selectProject: (projectPath: string) => StudioControlProjectSelectionResponse;
  activateResource: (
    pathSegments: string[],
    alreadyActive: boolean
  ) => StudioControlActivationResponse;
};

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

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

function statusPathSegments(pathname: string): string[] | null {
  if (pathname === "/v1/status" || pathname === "/v1/studio/status") {
    return [];
  }
  const prefix = "/v1/studio/";
  const suffix = "/status";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    return null;
  }
  const resourcePath = pathname.slice(prefix.length, -suffix.length);
  return decodePathSegments(resourcePath);
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
  const resourcePath = pathname.slice(prefix.length, -suffix.length);
  return decodePathSegments(resourcePath);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export async function routeStudioControlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: StudioControlRouteDependencies
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const method = request.method ?? "GET";
  if (
    method === "GET" &&
    (url.pathname === "/v1/focused" || url.pathname === "/v1/studio/focused")
  ) {
    const payload = await getStudioRuntimeFocused(dependencies.snapshotProvider);
    writeJson(response, 200, payload);
    return;
  }

  const segments = statusPathSegments(url.pathname);
  if (method === "GET" && segments !== null) {
    const payload = await getStudioRuntimeStatus(
      dependencies.snapshotProvider,
      segments
    );
    if (!payload) {
      writeJson(response, 404, { error: "studio_resource_not_found" });
      return;
    }
    writeJson(response, 200, payload);
    return;
  }

  const activationSegments = activationPathSegments(url.pathname);
  if (method === "POST" && activationSegments !== null) {
    const status = await getStudioRuntimeStatus(
      dependencies.snapshotProvider,
      activationSegments
    );
    if (!status) {
      writeJson(response, 404, {
        error: {
          code: "studio_resource_not_found",
          message: "Studio resource not found.",
        },
      });
      return;
    }
    const targetPath = isStringArray(status.activation_target_path)
      ? status.activation_target_path
      : null;
    if (!targetPath || targetPath.length === 0) {
      writeJson(response, 400, {
        error: {
          code: "studio_activation_unsupported",
          message: "No activatable Studio resource is available from this context.",
          recovery:
            "Use `cd` to inspect a window, workbench, layout, or panel, then run `activate`.",
        },
      });
      return;
    }
    const targetStatus = await getStudioRuntimeStatus(
      dependencies.snapshotProvider,
      targetPath
    );
    const result = dependencies.activateResource(
      targetPath,
      targetStatus?.active === true
    );
    writeJson(response, result.accepted ? 200 : 409, result);
    return;
  }

  if (method === "POST" && url.pathname === "/v1/project/select") {
    const body = (await readJsonBody(request)) as StudioControlProjectSelectionRequest;
    const result = dependencies.selectProject(body.project_path?.trim() || "");
    writeJson(response, result.accepted ? 200 : 409, result);
    return;
  }

  writeJson(response, 404, { error: "not_found" });
}
