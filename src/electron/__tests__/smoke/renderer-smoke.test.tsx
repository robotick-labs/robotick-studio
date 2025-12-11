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
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  const windowObject = dom.window as unknown as Window & typeof globalThis;
  globalThis.window = windowObject;
  globalThis.document = windowObject.document;
  globalThis.navigator = windowObject.navigator as Navigator;
  const props = Object.getOwnPropertyNames(windowObject).filter(
    (prop) => !(prop in globalThis)
  );
  for (const prop of props) {
    try {
      // @ts-ignore
      globalThis[prop] = (windowObject as Record<string, unknown>)[prop];
    } catch {
      // ignore read-only globals (crypto, performance, etc.)
    }
  }
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

  it("renders the Telemetry workspace when navigating directly to /telemetry", async () => {
    window.localStorage?.setItem(
      "robotick:last-workspace:global",
      "/telemetry"
    );
    window.localStorage?.setItem(
      "robotick:last-workspace:%2Fmock%2Fproject",
      "/telemetry"
    );
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TestLauncherProviders>
          <MemoryRouter initialEntries={["/telemetry"]}>
            <AppRoutes />
          </MemoryRouter>
        </TestLauncherProviders>
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.innerHTML).toContain('data-testid="workspace-telemetry"');

    await act(async () => {
      root.unmount();
    });
  });
});
