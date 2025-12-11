import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

vi.mock("../../../renderer/components/workspaces/WorkspaceView", () => ({
  WorkspaceView: ({ workspace }: { workspace: { id: string } }) => (
    <div data-testid={`workspace-${workspace.id}`}>{workspace.id}</div>
  ),
}));

import { AppRoutes } from "../../../renderer/Router";
import { TestLauncherProviders } from "../../../__tests__/helpers/mocks";
import { setupTestDomEnvironment } from "../../../__tests__/helpers/setupTestDomEnvironment";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let cleanupDom: (() => void) | null = null;

beforeEach(() => {
  const env = setupTestDomEnvironment({
    resetTelemetry: false,
    resetLauncher: false,
  });
  cleanupDom = env.cleanup;
});

afterEach(() => {
  cleanupDom?.();
  cleanupDom = null;
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
    window.localStorage.setItem(
      "robotick:last-workspace:global",
      "/telemetry"
    );
    window.localStorage.setItem(
      "robotick:last-workspace:mock-project",
      "/telemetry"
    );
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

    expect(container.innerHTML).toContain('data-testid="workspace-telemetry"');

    await act(async () => {
      root.unmount();
    });
  });
});
