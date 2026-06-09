import { describe, expect, it } from "vitest";
import { resolvedWorkbenches } from "../../../renderer/Router";

describe("Workbench router configuration", () => {
  it("exposes workbench routes for every configured entry", () => {
    expect(resolvedWorkbenches.length).toBeGreaterThan(0);
    for (const workbench of resolvedWorkbenches) {
      expect(workbench.path).toMatch(/^\//);
      expect(workbench.editor).toBeTruthy();
    }
  });
});
