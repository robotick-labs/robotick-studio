import type { IncomingMessage, ServerResponse } from "http";
import type {
  StudioControlActivationResponse,
  StudioControlProjectSelectionRequest,
  StudioControlProjectSelectionResponse,
} from "../../common/studio-control-contract";
import type { StudioDiagnosticsProvider } from "./studio-diagnostics";
import type { StudioRuntimeSnapshotProvider } from "./studio-runtime-snapshot";
import type { ElectronTelemetryService } from "../telemetry/electron-telemetry-service";
import { dispatchStudioControlCommand } from "./studio-command-registry";

export type StudioControlRouteDependencies = {
  snapshotProvider: StudioRuntimeSnapshotProvider;
  diagnosticsProvider: StudioDiagnosticsProvider;
  selectProject: (projectPath: string) => StudioControlProjectSelectionResponse;
  activateResource: (
    pathSegments: string[],
    alreadyActive: boolean
  ) => StudioControlActivationResponse;
  telemetryService?: ElectronTelemetryService;
};

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function writeBytes(
  response: ServerResponse,
  statusCode: number,
  body: Buffer | Uint8Array,
  contentType: string,
  headers?: Record<string, string>
) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": String(buffer.byteLength),
    ...(headers ?? {}),
  });
  response.end(buffer);
}

export async function readStudioControlJsonBody(
  request: IncomingMessage
): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

export async function routeStudioControlRequest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: StudioControlRouteDependencies
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const method = request.method ?? "GET";
  const body =
    method === "POST"
      ? ((await readStudioControlJsonBody(request)) as StudioControlProjectSelectionRequest)
      : null;
  const result = await dispatchStudioControlCommand(
    method,
    `${url.pathname}${url.search}`,
    dependencies,
    body
  );
  if (result) {
    if ("body" in result) {
      writeBytes(
        response,
        result.statusCode,
        result.body,
        result.contentType,
        result.headers,
      );
    } else {
      writeJson(response, result.statusCode, result.payload);
    }
    return;
  }

  writeJson(response, 404, { error: "not_found" });
}
