import { describe, expect, it } from "vitest";
import { classifyDiagnosticsFetchFailure } from "../../main/studio-control/studio-diagnostics";

describe("Studio diagnostics failure classification", () => {
  it("classifies common fetch and websocket failures", () => {
    expect(
      classifyDiagnosticsFetchFailure({
        url: "http://127.0.0.1:7001/v1/launcher/runtime",
        statusCode: null,
        errorName: "TypeError",
        errorMessage: "Failed to fetch",
        staleEndpointCandidates: ["http://127.0.0.1:7001"],
        currentHubEndpoint: "http://127.0.0.1:7000",
      })
    ).toBe("stale_endpoint");

    expect(
      classifyDiagnosticsFetchFailure({
        url: "http://127.0.0.1:7000/v1/studio/projects",
        statusCode: null,
        errorName: "TypeError",
        errorMessage: "CORS policy blocked the request",
      })
    ).toBe("cors");

    expect(
      classifyDiagnosticsFetchFailure({
        url: "http://127.0.0.1:7999/v1/launcher/runtime",
        statusCode: null,
        errorName: "TypeError",
        errorMessage: "Failed to fetch",
      })
    ).toBe("refused_connection");

    expect(
      classifyDiagnosticsFetchFailure({
        url: "http://127.0.0.1:7000/v1/studio/projects",
        statusCode: null,
        errorName: "AbortError",
        errorMessage: "This operation was aborted",
      })
    ).toBe("timeout");

    expect(
      classifyDiagnosticsFetchFailure({
        url: "http://not-a-host.invalid/v1/studio/projects",
        statusCode: null,
        errorName: "TypeError",
        errorMessage: "getaddrinfo ENOTFOUND not-a-host.invalid",
      })
    ).toBe("dns");

    expect(
      classifyDiagnosticsFetchFailure({
        url: "http://127.0.0.1:7000/v1/studio/projects",
        statusCode: 503,
        errorName: null,
        errorMessage: null,
      })
    ).toBe("non_ok_http");

    expect(
      classifyDiagnosticsFetchFailure({
        url: "ws://127.0.0.1:7001/v1/launcher/models/logs/stream",
        statusCode: null,
        errorName: "WebSocketFailure",
        errorMessage: "websocket upgrade failed",
      })
    ).toBe("websocket_upgrade_failure");
  });
});
