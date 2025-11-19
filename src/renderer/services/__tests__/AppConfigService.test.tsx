import { describe, expect, it } from "vitest";
import { EditorsConfig, WorkspacesConfig } from "../../services/AppConfigService";

describe("AppConfigService", () => {
  it("loads workspace definitions from YAML", () => {
    expect(WorkspacesConfig.length).toBeGreaterThan(0);
    const telemetry = WorkspacesConfig.find((workspace) => workspace.id === "telemetry");
    expect(telemetry).toBeDefined();
    expect(telemetry?.path).toBe("/telemetry");
    expect(telemetry?.group).toBe("test");
    expect(telemetry?.editor).toBeDefined();
  });

  it("loads editor definitions that workspaces can reference", () => {
    expect(EditorsConfig.length).toBeGreaterThan(0);
    const home = EditorsConfig.find((editor) => editor.id === "home");
    expect(home).toBeDefined();
    expect(home?.module).toMatch(/HomePage\.tsx$/);
  });
});
