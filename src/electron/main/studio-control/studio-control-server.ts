import http from "http";
import type { AddressInfo } from "net";
import { routeStudioControlRequest, type StudioControlRouteDependencies } from "./studio-control-routes";

export type StudioControlServer = {
  endpoint: string;
  close: () => Promise<void>;
};

export async function startStudioControlServer(
  dependencies: StudioControlRouteDependencies
): Promise<StudioControlServer> {
  const server = http.createServer((request, response) => {
    routeStudioControlRequest(request, response, dependencies).catch((error) => {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(
        `${JSON.stringify({
          error: "studio_control_error",
          message: error instanceof Error ? error.message : String(error),
        })}\n`
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export async function registerStudioControlEndpointWithHub(
  hubEndpoint: string | undefined,
  instanceName: string,
  endpoint: string
): Promise<void> {
  const normalizedHubEndpoint = hubEndpoint?.trim();
  if (!normalizedHubEndpoint) {
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    await fetch(
      `${normalizedHubEndpoint}/v1/studio/instances/${encodeURIComponent(instanceName)}/control-endpoint`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ endpoint }),
        signal: controller.signal,
      }
    );
  } catch (error) {
    console.warn("[StudioControl] Failed to register control endpoint", error);
  } finally {
    clearTimeout(timeout);
  }
}
