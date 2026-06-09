import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../renderer/Router";
import { WorkbenchesConfig } from "../../renderer/services/AppConfigService";
import { TestLauncherProviders } from "../helpers/mocks";

vi.mock("../../renderer/components/workbenches/WorkbenchView", () => ({
  WorkbenchView: ({ workbench }: { workbench: { id: string } }) => (
    <div data-testid={`workbench-${workbench.id}`}>{workbench.id}</div>
  ),
}));

vi.mock("../../renderer/services/AppConfigService", async () => {
  const actual = await vi.importActual<
    typeof import("../../renderer/services/AppConfigService")
  >("../../renderer/services/AppConfigService");
  return {
    ...actual,
    useAppConfig: () => ({
      workbenches: actual.WorkbenchesConfig,
      windows: [],
      editors: [],
      loading: false,
      source: "seed" as const,
    }),
  };
});

describe("workbench route smoke tests", () => {
  for (const workbench of WorkbenchesConfig) {
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
