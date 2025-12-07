import { describe, expect, it } from "vitest";
import { resolvedWorkspaces } from "../../../renderer/Router";

describe("Workspace router configuration", () => {
  it("exposes workspace routes for every configured entry", () => {
    expect(resolvedWorkspaces.length).toBeGreaterThan(0);
    for (const workspace of resolvedWorkspaces) {
      expect(workspace.path).toMatch(/^\//);
      expect(workspace.editor).toBeTruthy();
    }
  });
});
