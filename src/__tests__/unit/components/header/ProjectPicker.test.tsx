import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  };
});

vi.mock("../../../../renderer/data-sources/launcher", () => ({
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
    projectPickerMocks.state.projectPath = "/repo/robots/barr-e";
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
    expect(select.textContent).toContain("Tim-E [Locked: studio-2222]");
    expect(select.textContent?.match(/Barr-E/g)?.length).toBe(1);
  });

  it("dispatches project changes when a different option is selected", () => {
    render(<ProjectPicker />);
    fireEvent.change(screen.getByLabelText("Select project"), {
      target: { value: "/repo/robots/tim-e/tim-e.project.yaml" },
    });
    expect(projectPickerMocks.requestProjectChange).toHaveBeenCalledWith(
      "/repo/robots/tim-e/tim-e.project.yaml"
    );
  });
});
