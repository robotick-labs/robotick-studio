import { JSDOM } from "jsdom";
import { vi } from "vitest";
import * as projectsApi from "../../renderer/data-sources/launcher/internal/projects-api";
import {
  resetLauncherDataTestState,
  resetTelemetryTestState,
} from "./renderWithProviders";

type SetupOptions = {
  url?: string;
  resetTelemetry?: boolean;
  resetLauncher?: boolean;
};

type SetupResult = {
  cleanup: () => void;
  createProjectSettingsSpy: () => ReturnType<typeof vi.spyOn>;
};

export function setupTestDomEnvironment(
  options: SetupOptions = {}
): SetupResult {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevNavigator = globalThis.navigator;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: options.url ?? "http://localhost/",
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
      // @ts-expect-error dynamic assignment for test helpers
      globalThis[prop] = (windowObject as Record<string, unknown>)[prop];
    } catch {
      // ignore read-only globals (crypto, performance, etc.)
    }
  }

  if (options.resetTelemetry !== false) {
    resetTelemetryTestState();
  }
  if (options.resetLauncher !== false) {
    resetLauncherDataTestState();
  }

  const projectSettingsSpies: Array<ReturnType<typeof vi.spyOn>> = [];
  const createProjectSettingsSpy = () => {
    const spy = vi
      .spyOn(projectsApi, "fetchProjectSettingsList")
      .mockResolvedValue([]);
    projectSettingsSpies.push(spy);
    return spy;
  };

  const cleanup = () => {
    projectSettingsSpies.forEach((spy) => spy.mockRestore());
    if (prevWindow) {
      globalThis.window = prevWindow;
    }
    if (prevDocument) {
      globalThis.document = prevDocument;
    }
    if (prevNavigator) {
      globalThis.navigator = prevNavigator;
    }
  };

  return { cleanup, createProjectSettingsSpy };
}
