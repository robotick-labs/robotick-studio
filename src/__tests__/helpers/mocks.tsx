import React from "react";
import { vi } from "vitest";

export function mockWorkspaceView() {
  vi.mock("../../renderer/components/workspaces/WorkspaceView", () => ({
    WorkspaceView: ({ workspace }: { workspace: { id: string } }) => (
      <div data-testid={`workspace-${workspace.id}`}>{workspace.id}</div>
    ),
  }));
}
