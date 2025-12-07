import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { mockWorkspaceView } from "../helpers/mocks";

mockWorkspaceView();

import { AppRoutes } from "../../renderer/Router";

describe("AppRoutes smoke test", () => {
  it("renders the Home workspace when navigating to the root path", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <AppRoutes />
        </MemoryRouter>
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.innerHTML).toContain('data-testid="workspace-home"');

    await act(async () => {
      root.unmount();
    });
  });
});
