import { describe, expect, it } from "vitest";
import { resolvedWorkspaces } from "../Router";

describe("Workspace router configuration", () => {
  it("resolves lazy components for all configured workspaces", () => {
    expect(resolvedWorkspaces.length).toBeGreaterThan(0);
    for (const workspace of resolvedWorkspaces) {
      expect(workspace.Component).toBeDefined();
    }
  });
});
