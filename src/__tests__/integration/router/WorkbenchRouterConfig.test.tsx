import { describe, expect, it } from "vitest";
import { WorkbenchesConfig } from "../../../renderer/services/AppConfigService";

describe("Workbench router configuration", () => {
  it("exposes seeded workbench routes for every configured entry", () => {
    expect(WorkbenchesConfig.length).toBeGreaterThan(0);
    for (const workbench of WorkbenchesConfig) {
      expect(workbench.path).toMatch(/^\//);
      expect(workbench.editor).toBeTruthy();
    }
  });
});
