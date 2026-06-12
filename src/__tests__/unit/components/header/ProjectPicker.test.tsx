import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectPickerMocks = vi.hoisted(() => {
  const state = {
    projectPath: "/repo/robots/barr-e",
  };
  return {
    state,
    requestProjectChange: vi.fn(),
    projects: [
      {
        path: "/repo/robots/barr-e/barr-e.project.yaml",
        name: "Barr-E",
      },
      {
        path: "/repo/robots/tim-e/tim-e.project.yaml",
        name: "Tim-E",
      },
    ],
    fetchProjectSettingsData: vi.fn(),
  };
});

vi.mock("../../../../renderer/data-sources/launcher", () => ({
  useLauncherService: () => projectPickerMocks,
  Project: {
    Context: {
      use: () => ({
        projectPath: projectPickerMocks.state.projectPath,
      }),
    },
    Hooks: {
      useSettingsList: () => ({
        projects: projectPickerMocks.projects,
        loading: false,
        error: null,
      }),
      useChangeConfirmation: () => ({
        requestProjectChange: projectPickerMocks.requestProjectChange,
        confirmationDialog: null,
      }),
      useLockStatuses: () => ({
        statusesByPath: {
          "/repo/robots/barr-e/barr-e.project.yaml": {
            projectPath: "/repo/robots/barr-e/barr-e.project.yaml",
            state: "current",
          },
          "/repo/robots/tim-e/tim-e.project.yaml": {
            projectPath: "/repo/robots/tim-e/tim-e.project.yaml",
            state: "locked",
            instanceName: "studio-2222",
          },
        },
      }),
    },
  },
}));

import { ProjectPicker } from "../../../../renderer/components/header/ProjectPicker";

describe("ProjectPicker", () => {
  beforeEach(() => {
    projectPickerMocks.state.projectPath =
      "/repo/robots/barr-e/barr-e.project.yaml";
    projectPickerMocks.projects = [
      {
        path: "/repo/robots/barr-e/barr-e.project.yaml",
        name: "Barr-E",
      },
      {
        path: "/repo/robots/tim-e/tim-e.project.yaml",
        name: "Tim-E",
      },
    ];
    projectPickerMocks.fetchProjectSettingsData.mockResolvedValue({
      name: "Barr.e",
    });
    projectPickerMocks.fetchProjectSettingsData.mockClear();
    projectPickerMocks.requestProjectChange.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("annotates current and externally locked projects without duplicating the current one", () => {
    render(<ProjectPicker />);
    const select = screen.getByLabelText("Select project") as HTMLSelectElement;
    expect(select.value).toBe("/repo/robots/barr-e/barr-e.project.yaml");
    expect(select.textContent).toContain("Barr-E");
    expect(select.textContent).not.toContain("[Open here]");
    expect(select.textContent).toContain("🔒 Tim-E");
    expect(select.textContent).not.toContain("studio-2222");
    expect(
      (screen.getByRole("option", { name: "🔒 Tim-E" }) as HTMLOptionElement)
        .disabled
    ).toBe(false);
    expect(select.textContent?.match(/Barr-E/g)?.length).toBe(1);
  });

  it("ignores locked project selections without disabling their option", () => {
    render(<ProjectPicker />);
    fireEvent.change(screen.getByLabelText("Select project"), {
      target: { value: "/repo/robots/tim-e/tim-e.project.yaml" },
    });
    expect(projectPickerMocks.requestProjectChange).not.toHaveBeenCalled();
  });

  it("dispatches project changes when a different option is selected", () => {
    projectPickerMocks.projects.push({
      path: "/repo/robots/alf-e/alf-e.project.yaml",
      name: "Alf-E",
    });
    render(<ProjectPicker />);
    fireEvent.change(screen.getByLabelText("Select project"), {
      target: { value: "/repo/robots/alf-e/alf-e.project.yaml" },
    });
    expect(projectPickerMocks.requestProjectChange).toHaveBeenCalledWith(
      "/repo/robots/alf-e/alf-e.project.yaml"
    );
  });

  it("does not collapse distinct project files that only share the same basename", () => {
    projectPickerMocks.state.projectPath =
      "/repo/archive/barr-e/barr-e.project.yaml";
    projectPickerMocks.projects = [
      {
        path: "/repo/robots/barr-e/barr-e.project.yaml",
        name: "Barr-E",
      },
      {
        path: "/repo/sim/barr-e/barr-e.project.yaml",
        name: "Barr-E Sim",
      },
    ];

    render(<ProjectPicker />);

    const select = screen.getByLabelText("Select project") as HTMLSelectElement;
    expect(select.value).toBe("/repo/archive/barr-e/barr-e.project.yaml");
  });

  it("uses the project settings name when the selected yaml path is not in the project list", async () => {
    projectPickerMocks.state.projectPath =
      "/repo/archive/barr-e/barr-e.project.yaml";
    projectPickerMocks.projects = [];

    render(<ProjectPicker />);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Barr.e" })).toBeTruthy();
    });
    expect(projectPickerMocks.fetchProjectSettingsData).toHaveBeenCalledWith(
      "/repo/archive/barr-e/barr-e.project.yaml"
    );
    expect(screen.queryByRole("option", { name: "barr-e.project.yaml" })).toBeNull();
  });
});
