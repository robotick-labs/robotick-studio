import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import { TelemetryApp } from "../../../renderer/components/editors/telemetry/view/TelemetryApp";
import {
  renderWithProviders,
  resetTelemetryTestState,
  resetLauncherDataTestState,
} from "../../../__tests__/helpers/renderWithProviders";
import { createMockLauncherService } from "../../../__tests__/helpers/mocks";
import * as projectsApi from "../../../renderer/data-sources/launcher/internal/projects-api";

describe("Telemetry smoke flow", () => {
  let settingsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "http://localhost/",
    });
    const windowObject = dom.window as unknown as Window & typeof globalThis;
    globalThis.window = windowObject;
    globalThis.document = windowObject.document;
    globalThis.navigator = windowObject.navigator as Navigator;
    resetTelemetryTestState();
    resetLauncherDataTestState();
    settingsSpy = vi
      .spyOn(projectsApi, "fetchProjectSettingsList")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    settingsSpy.mockRestore();
  });

  it("prompts the user to select a project when none is active", async () => {
    const launcherService = createMockLauncherService({
      projectPath: "",
    });

    const { container, unmount } = renderWithProviders(<TelemetryApp />, {
      launcherService,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toContain(
      "Select a project to view telemetry."
    );

    unmount();
  });
});
