import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProjectSettingsDataMock = vi.hoisted(() => vi.fn());

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
}));

import {
  EditorRegistryProvider,
  loadInitialEditorRegistryState,
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
  });

  it("adds native plugin-provided editors without requiring project plugin settings", async () => {
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
      expect(screen.getByTestId("editor-ids").textContent).toContain(
        "remote-control"
      )
    );
  });

  it("exposes native plugin-provided editors immediately when bootstrapped before render", async () => {
    const bootstrappedSettings = {
      tooling: {
        studio_plugins: [],
      },
    };
    fetchProjectSettingsDataMock.mockImplementation(
      () => new Promise(() => undefined)
    );

    render(
      <EditorRegistryProvider
        initialBootstrapState={{
          projectPath: "/tmp/barr-e.project.yaml",
          projectSettings: bootstrappedSettings,
        }}
      >
        <RegistryProbe />
      </EditorRegistryProvider>
    );

    expect(screen.getByTestId("editor-ids").textContent).toContain(
      "remote-control"
    );
    expect(fetchProjectSettingsDataMock).not.toHaveBeenCalled();
  });

  it("does not expose external plugin editors when the project does not declare them", async () => {
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
    expect(screen.getByTestId("editor-ids").textContent).toContain("remote-control");
    expect(screen.getByTestId("editor-ids").textContent).not.toContain("animation-editor");
  });

  it("exposes external plugin editors when the project declares the plugin", async () => {
    fetchProjectSettingsDataMock.mockResolvedValue({
      tooling: {
        studio_plugins: [{ id: "robotick-animation" }],
      },
    });

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

  it("loads bootstrapped project settings from the launcher service", async () => {
    const launcherService = {
      getProjectPath: () => "/tmp/barr-e.project.yaml",
      fetchProjectSettingsData: vi.fn().mockResolvedValue({
        tooling: {
          studio_plugins: [{ id: "robotick-animation" }],
        },
      }),
    };

    const bootstrapped = await loadInitialEditorRegistryState(
      launcherService as never
    );

    expect(bootstrapped).toEqual({
      projectPath: "/tmp/barr-e.project.yaml",
      projectSettings: {
        tooling: {
          studio_plugins: [{ id: "robotick-animation" }],
        },
      },
    });
    expect(launcherService.fetchProjectSettingsData).toHaveBeenCalledWith(
      "/tmp/barr-e.project.yaml"
    );
  });
});
