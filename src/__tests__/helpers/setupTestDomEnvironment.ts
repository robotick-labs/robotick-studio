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

/**
 * Create a JSDOM-based browser-like environment for tests and provide helpers to spy on project settings fetches.
 *
 * @param options - Optional setup flags:
 *   - `url`: the document URL to use for the JSDOM instance (default: `"http://localhost/"`).
 *   - `resetTelemetry`: if `false`, do not call `resetTelemetryTestState()`; otherwise telemetry state is reset.
 *   - `resetLauncher`: if `false`, do not call `resetLauncherDataTestState()`; otherwise launcher state is reset.
 * @returns An object containing:
 *   - `cleanup`: a function that restores any created spies and the previous global `window`, `document`, and `navigator`.
 *   - `createProjectSettingsSpy`: a helper that creates and returns a spy for `projectsApi.fetchProjectSettingsList` mocked to resolve to an empty array.
 */
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

  const addedGlobals: string[] = [];
  const props = Object.getOwnPropertyNames(windowObject);
  for (const prop of props) {
    const existed = Object.prototype.hasOwnProperty.call(globalThis, prop);
    if (existed) {
      continue;
    }
    try {
      // @ts-expect-error dynamic assignment for test helpers
      globalThis[prop] = (windowObject as Record<string, unknown>)[prop];
    } catch {
      // ignore read-only globals (crypto, performance, etc.)
    }
    addedGlobals.push(prop);
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
    dom.window.close();
    if (prevWindow !== undefined) {
      globalThis.window = prevWindow;
    } else {
      (globalThis as { window?: typeof globalThis.window }).window =
        {} as Window & typeof globalThis;
    }
    if (prevDocument !== undefined) {
      globalThis.document = prevDocument;
    } else {
      (globalThis as { document?: typeof globalThis.document }).document =
        {} as Document & typeof globalThis.document;
    }
    if (prevNavigator !== undefined) {
      globalThis.navigator = prevNavigator;
    } else {
      (globalThis as { navigator?: typeof globalThis.navigator }).navigator =
        {} as Navigator & typeof globalThis.navigator;
    }
    for (const key of addedGlobals) {
      if (key === "window" || key === "document" || key === "navigator") {
        continue;
      }
      try {
        delete (globalThis as Record<string, unknown>)[key];
      } catch {
        // ignore failures when deleting read-only globals
      }
    }
  };

  return { cleanup, createProjectSettingsSpy };
}
