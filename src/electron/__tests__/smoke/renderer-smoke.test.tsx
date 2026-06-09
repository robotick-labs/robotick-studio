import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

vi.mock("../../../renderer/components/workbenches/WorkbenchView", () => ({
  WorkbenchView: ({ workbench }: { workbench: { id: string } }) => (
    <div data-testid={`workbench-${workbench.id}`}>{workbench.id}</div>
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
  it("renders the Home workbench when the app boots", async () => {
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

  it("renders the Telemetry workbench when navigating directly to /telemetry", async () => {
    window.localStorage.setItem(
      "robotick:last-workbench:global",
      "/telemetry"
    );
    window.localStorage.setItem(
      "robotick:last-workbench:mock-project",
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

    expect(container.innerHTML).toContain('data-testid="workbench-telemetry"');

    await act(async () => {
      root.unmount();
    });
  });
});
