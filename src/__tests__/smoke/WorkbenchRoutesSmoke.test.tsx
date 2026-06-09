import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppRoutes, resolvedWorkbenches } from "../../renderer/Router";
import { TestLauncherProviders } from "../helpers/mocks";

vi.mock("../../renderer/components/workbenches/WorkbenchView", () => ({
  WorkbenchView: ({ workbench }: { workbench: { id: string } }) => (
    <div data-testid={`workbench-${workbench.id}`}>{workbench.id}</div>
  ),
}));

describe("workbench route smoke tests", () => {
  for (const workbench of resolvedWorkbenches) {
    it(`renders workbench '${workbench.id}' at path '${workbench.path}'`, () => {
      const markup = renderToString(
        <TestLauncherProviders>
          <MemoryRouter initialEntries={[workbench.path]}>
            <AppRoutes />
          </MemoryRouter>
        </TestLauncherProviders>
      );

      expect(markup).toContain(`data-testid="workbench-${workbench.id}"`);
    });
  }
});
