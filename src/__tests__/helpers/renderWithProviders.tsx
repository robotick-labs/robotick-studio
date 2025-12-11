import React from "react";
import { MemoryRouter } from "react-router-dom";
import { createRoot, Root } from "react-dom/client";
import { act } from "react";
import type { LauncherService } from "../../renderer/data-sources/launcher";
import { resetLauncherDataForTests } from "../../renderer/data-sources/launcher/test-utils";
import {
  resetTelemetryStore,
  TelemetryServiceProvider,
  createTelemetryService,
  type TelemetryService,
} from "../../renderer/data-sources/telemetry";
import { createMockLauncherService, TestLauncherProviders } from "./mocks";

if (typeof globalThis !== "undefined") {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

type RenderWithProvidersOptions = {
  route?: string | string[];
  launcherService?: LauncherService;
  launcherServiceOverrides?: Partial<LauncherService>;
  projectPath?: string;
  launcherProfile?: string;
  telemetryService?: TelemetryService;
};

type RenderResult = {
  container: HTMLElement;
  root: Root;
  service: LauncherService;
  rerender: (node: React.ReactElement) => void;
  unmount: () => void;
};

/**
 * Render a React element inside the test provider tree (TelemetryServiceProvider and TestLauncherProviders)
 * and a MemoryRouter, returning the DOM/root/service handles and helpers to rerender or unmount.
 *
 * @param ui - The React element to render.
 * @param options - Optional configuration for the test render.
 * @param options.route - Initial route or routes for the MemoryRouter; defaults to "/".
 * @param options.launcherService - Custom LauncherService to use instead of creating a mock.
 * @param options.launcherServiceOverrides - Overrides for the auto-created mock launcher service.
 * @param options.projectPath - Project path to seed into the mock launcher service when created.
 * @param options.launcherProfile - Launcher profile to seed into the mock launcher service when created.
 * @param options.telemetryService - Custom TelemetryService to use instead of the default test service.
 * @returns An object containing the mounted container, the React root, the launcher service in use,
 *          and `rerender`/`unmount` helper functions.
 * @throws If a DOM-like document is not available (the function requires a DOM environment).
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {}
): RenderResult {
  if (typeof document === "undefined") {
    throw new Error(
      "renderWithProviders requires a DOM-like environment. Call setupJSDOM() in your test."
    );
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let attachedContainer: HTMLElement | null = container;
  let attachedRoot: Root | null = root;
  const service =
    options.launcherService ??
    createMockLauncherService({
      projectPath: options.projectPath,
      launcherProfile: options.launcherProfile,
      ...(options.launcherServiceOverrides ?? {}),
    });
  const telemetryService =
    options.telemetryService ?? createTelemetryService();

  const initialEntries = Array.isArray(options.route)
    ? options.route
    : [options.route ?? "/"];

  const renderTree = (node: React.ReactElement) => (
    <TelemetryServiceProvider service={telemetryService}>
      <TestLauncherProviders service={service}>
        <MemoryRouter initialEntries={initialEntries}>{node}</MemoryRouter>
      </TestLauncherProviders>
    </TelemetryServiceProvider>
  );

  act(() => {
    root.render(renderTree(ui));
  });

  return {
    container,
    root,
    service,
    rerender(nextUi) {
      act(() => {
        root.render(renderTree(nextUi));
      });
    },
    unmount() {
      const rootToUnmount = attachedRoot;
      const containerToRemove = attachedContainer;
      if (!rootToUnmount || !containerToRemove) {
        return;
      }
      act(() => {
        rootToUnmount.unmount();
      });
      containerToRemove.remove();
      attachedContainer = null;
      attachedRoot = null;
    },
  };
}

/**
 * Resets telemetry state used by tests to a clean default.
 *
 * This clears any recorded telemetry events and stored telemetry state so subsequent tests start with no telemetry data.
 */
export function resetTelemetryTestState(): void {
  resetTelemetryStore();
}

/**
 * Reset launcher data used in tests to a clean default state.
 */
export function resetLauncherDataTestState(): void {
  resetLauncherDataForTests();
}