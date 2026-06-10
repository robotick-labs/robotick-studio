import type { IncomingMessage, ServerResponse } from "http";
import type {
  StudioControlProjectSelectionRequest,
  StudioControlProjectSelectionResponse,
} from "../../common/studio-control-contract";
import type { StudioRuntimeSnapshotProvider } from "./studio-runtime-snapshot";
import { getStudioRuntimeStatus } from "./studio-runtime-snapshot";

export type StudioControlRouteDependencies = {
  snapshotProvider: StudioRuntimeSnapshotProvider;
  selectProject: (projectPath: string) => StudioControlProjectSelectionResponse;
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
  return resourcePath.split("/").filter((segment) => segment.length > 0);
}

export async function routeStudioControlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: StudioControlRouteDependencies
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const method = request.method ?? "GET";
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

  if (method === "POST" && url.pathname === "/v1/project/select") {
    const body = (await readJsonBody(request)) as StudioControlProjectSelectionRequest;
    const result = dependencies.selectProject(body.project_path?.trim() || "");
    writeJson(response, result.accepted ? 200 : 409, result);
    return;
  }

  writeJson(response, 404, { error: "not_found" });
}
