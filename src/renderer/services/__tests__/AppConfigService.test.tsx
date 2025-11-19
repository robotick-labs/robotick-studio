import { describe, expect, it } from "vitest";
import { WorkspacesConfig } from "../../services/AppConfigService";

describe("AppConfigService", () => {
  it("loads workspace definitions from YAML", () => {
    expect(WorkspacesConfig.length).toBeGreaterThan(0);
    const telemetry = WorkspacesConfig.find((workspace) => workspace.id === "telemetry");
    expect(telemetry).toBeDefined();
    expect(telemetry?.path).toBe("/telemetry");
    expect(telemetry?.group).toBe("test");
  });
});
