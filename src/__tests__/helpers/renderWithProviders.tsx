import React from "react";
import { MemoryRouter } from "react-router-dom";
import { createRoot, Root } from "react-dom/client";
import { act } from "react";
import type { LauncherService } from "../../renderer/data-sources/launcher";
import { resetLauncherDataForTests } from "../../renderer/data-sources/launcher";
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
  const root = createRoot(container);
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
      act(() => {
        root.unmount();
      });
    },
  };
}

export function resetTelemetryTestState(): void {
  resetTelemetryStore();
}

export function resetLauncherDataTestState(): void {
  resetLauncherDataForTests();
}
