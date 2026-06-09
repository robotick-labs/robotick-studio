import { describe, expect, it } from "vitest";
import {
  EditorsConfig,
  WorkbenchesConfig,
} from "../../../renderer/services/AppConfigService";

describe("AppConfigService", () => {
  it("loads workbench definitions from YAML", () => {
    expect(WorkbenchesConfig.length).toBeGreaterThan(0);
    const telemetry = WorkbenchesConfig.find((workbench) => workbench.id === "telemetry");
    expect(telemetry).toBeDefined();
    expect(telemetry?.path).toBe("/telemetry");
    expect(telemetry?.group).toBe("test");
    expect(telemetry?.editor).toBeDefined();
  });

  it("loads editor definitions that workbenches can reference", () => {
    expect(EditorsConfig.length).toBeGreaterThan(0);
    const home = EditorsConfig.find((editor) => editor.id === "home");
    expect(home).toBeDefined();
    expect(home?.module).toMatch(/HomePage\.tsx$/);
  });
});
