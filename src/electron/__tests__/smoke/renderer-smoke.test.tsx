import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { JSDOM } from "jsdom";

vi.mock("../../../renderer/components/workspaces/WorkspaceView", () => ({
  WorkspaceView: ({ workspace }: { workspace: { id: string } }) => (
    <div data-testid={`workspace-${workspace.id}`}>{workspace.id}</div>
  ),
}));

import { AppRoutes } from "../../../renderer/Router";
import { TestLauncherProviders } from "../../../__tests__/helpers/mocks";

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  (globalThis as typeof globalThis & {
    window?: Window;
    document?: Document;
    navigator?: Navigator;
  }).window = dom.window as unknown as Window;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator as Navigator;
});

describe("Electron renderer smoke test", () => {
  it("renders the Home workspace when the app boots", async () => {
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

    expect(container.innerHTML).toContain('data-testid="workspace-home"');

    await act(async () => {
      root.unmount();
    });
  });
});
