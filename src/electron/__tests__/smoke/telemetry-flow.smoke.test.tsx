import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import { waitFor, within } from "@testing-library/react";
import { TelemetryApp } from "../../../renderer/components/editors/telemetry/view/TelemetryApp";
import {
  renderWithProviders,
} from "../../../__tests__/helpers/renderWithProviders";
import { createMockLauncherService } from "../../../renderer/data-sources/launcher";
import { setupTestDomEnvironment } from "../../../__tests__/helpers/setupTestDomEnvironment";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("Telemetry smoke flow", () => {
  let settingsSpy: ReturnType<typeof vi.spyOn>;
  let cleanupDom: (() => void) | null = null;

  beforeEach(() => {
    const env = setupTestDomEnvironment();
    cleanupDom = env.cleanup;
    settingsSpy = env.createProjectSettingsSpy();
  });

  afterEach(() => {
    settingsSpy.mockRestore();
    cleanupDom?.();
    cleanupDom = null;
  });

  it("prompts the user to select a project when none is active", async () => {
    const launcherService = createMockLauncherService({
      projectPath: "",
    });

    const { container, unmount } = renderWithProviders(<TelemetryApp />, {
      launcherService,
    });

    await waitFor(() => {
      const text = within(container).getByText(
        "Select a project to view telemetry."
      );
      expect(text).toBeInTheDocument();
    });

    unmount();
  });
});
