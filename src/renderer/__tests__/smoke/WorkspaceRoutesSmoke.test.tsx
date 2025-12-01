import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppRoutes, resolvedWorkspaces } from "../../Router";

vi.mock("../../components/workspaces/WorkspaceView", () => ({
  WorkspaceView: ({ workspace }: { workspace: { id: string } }) => (
    <div data-testid={`workspace-${workspace.id}`}>{workspace.id}</div>
  ),
}));

describe("workspace route smoke tests", () => {
  for (const workspace of resolvedWorkspaces) {
    it(`renders workspace '${workspace.id}' at path '${workspace.path}'`, () => {
      const markup = renderToString(
        <MemoryRouter initialEntries={[workspace.path]}>
          <AppRoutes />
        </MemoryRouter>
      );

      expect(markup).toContain(`data-testid="workspace-${workspace.id}"`);
    });
  }
});
