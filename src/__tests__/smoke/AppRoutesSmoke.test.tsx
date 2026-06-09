import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { mockWorkbenchView, TestLauncherProviders } from "../helpers/mocks";

mockWorkbenchView();

import { AppRoutes } from "../../renderer/Router";

describe("AppRoutes smoke test", () => {
  it("renders the Home workbench when navigating to the root path", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TestLauncherProviders>
          <MemoryRouter initialEntries={["/"]}>
            <AppRoutes />
          </MemoryRouter>
        </TestLauncherProviders>
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.innerHTML).toContain('data-testid="workbench-home"');

    await act(async () => {
      root.unmount();
    });
  });
});
