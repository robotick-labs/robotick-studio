import { describe, expect, it } from "vitest";
import { RoutesConfig } from "../../services/AppConfigService";

describe("AppConfigService", () => {
  it("loads route definitions from YAML", () => {
    expect(RoutesConfig.length).toBeGreaterThan(0);
    const telemetry = RoutesConfig.find((route) => route.id === "telemetry");
    expect(telemetry).toBeDefined();
    expect(telemetry?.path).toBe("/telemetry");
    expect(telemetry?.group).toBe("test");
  });
});
