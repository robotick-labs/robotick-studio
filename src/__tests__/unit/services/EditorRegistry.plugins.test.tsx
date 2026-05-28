import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProjectSettingsDataMock = vi.hoisted(() => vi.fn());
const projectModelsState = vi.hoisted(() => ({
  value: {
    data: [],
    loading: false,
    error: null,
  } as {
    data: Array<Record<string, unknown>>;
    loading: boolean;
    error: string | null;
  },
}));

vi.mock("../../../renderer/data-sources/launcher/internal/ProjectContext", () => ({
  useProjectContext: () => ({
    projectPath: "/tmp/barr-e.project.yaml",
    launcherProfile: "local:ALL",
    setProjectPath: vi.fn(),
    setLauncherProfile: vi.fn(),
  }),
}));

vi.mock("../../../renderer/data-sources/launcher", () => ({
  useLauncherService: () => ({
    fetchProjectSettingsData: fetchProjectSettingsDataMock,
  }),
  ProjectData: {
    use: () => ({
      projectModels: projectModelsState.value,
    }),
  },
}));

import {
  EditorRegistryProvider,
  useEditorRegistry,
} from "../../../renderer/services/EditorRegistry";

function RegistryProbe() {
  const { listEditorEntries } = useEditorRegistry();
  const ids = listEditorEntries().map((entry) => entry.id).sort();
  return <div data-testid="editor-ids">{ids.join(",")}</div>;
}

describe("EditorRegistry plugin discovery", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    fetchProjectSettingsDataMock.mockReset();
    projectModelsState.value = {
      data: [],
      loading: false,
      error: null,
    };
  });

  it("adds plugin-provided editors when the current project declares the plugin source", async () => {
    fetchProjectSettingsDataMock.mockResolvedValue({
      tooling: {
        studio_plugins: [
          {
            id: "robotick-animation",
            local_path: "${PROJECT_DIR}/../../robotick/robotick-animation",
          },
        ],
      },
    });
    projectModelsState.value = {
      data: [
        {
          modelPath: "models/barr-e-animator.model.yaml",
          modelShortName: "barr-e-animator",
          modelName: "Barr.e Animator",
          telemetryPort: 7089,
          telemetryBaseUrl: "http://localhost:7089",
          telemetryPushRateHz: 20,
          data: {
            studio: {
              plugins: [
                {
                  id: "robotick-animation",
                  editors: ["animation-editor"],
                },
              ],
            },
          },
        },
      ],
      loading: false,
      error: null,
    };

    render(
      <EditorRegistryProvider>
        <RegistryProbe />
      </EditorRegistryProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("editor-ids").textContent).toContain(
        "animation-editor"
      )
    );
  });

  it("does not expose animation-editor when the project does not declare the plugin source", async () => {
    fetchProjectSettingsDataMock.mockResolvedValue({
      tooling: {
        studio_plugins: [],
      },
    });

    render(
      <EditorRegistryProvider>
        <RegistryProbe />
      </EditorRegistryProvider>
    );

    await waitFor(() =>
      expect(fetchProjectSettingsDataMock).toHaveBeenCalled()
    );
    expect(screen.getByTestId("editor-ids").textContent).not.toContain("animation-editor");
  });
});
