import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const homePageMocks = vi.hoisted(() => {
  const state = {
    projectPath: "",
  };
  const selectProjectPath = vi.fn(async (path: string) => {
    state.projectPath = path;
    return {
      accepted: true,
      currentProjectPath: path,
      issue: null,
    };
  });
  return {
    state,
    selectProjectPath,
    requestProjectChange: vi.fn(),
    projects: [
      {
        path: "/repo/robots/barr-e/barr-e.project.yaml",
        name: "Barr-E",
        description: "Barr-E project",
      },
      {
        path: "/repo/robots/tim-e/tim-e.project.yaml",
        name: "Tim-E",
        description: "Tim-E project",
      },
    ],
  };
});

vi.mock("../../../../../renderer/data-sources/launcher", () => ({
  Project: {
    Context: {
      use: () => ({
        projectPath: homePageMocks.state.projectPath,
        selectProjectPath: homePageMocks.selectProjectPath,
      }),
    },
    Hooks: {
      useSettingsList: () => ({
        projects: homePageMocks.projects,
        loading: false,
        error: null,
      }),
      useChangeConfirmation: () => ({
        requestProjectChange: homePageMocks.requestProjectChange,
        confirmationDialog: null,
      }),
      useLockStatuses: () => ({
        statusesByPath: {},
      }),
    },
  },
}));

vi.mock("../../../../../renderer/utils/appName", () => ({
  getRendererAppName: () => "Robotick Studio",
}));

import HomePage, {
  resetRequestedProjectBootstrapForTests,
} from "../../../../../renderer/components/editors/home/HomePage";

describe("HomePage", () => {
  beforeEach(() => {
    resetRequestedProjectBootstrapForTests();
    homePageMocks.state.projectPath = "";
    homePageMocks.selectProjectPath.mockClear();
    homePageMocks.requestProjectChange.mockClear();
    (window as typeof window & { robotick?: any }).robotick = {
      environment: {
        selectedProject: "barr-e",
      },
    };
  });

  it("dispatches project change requests when a project card is clicked", () => {
    render(<HomePage />);
    fireEvent.click(screen.getByText("Tim-E"));
    expect(homePageMocks.requestProjectChange).toHaveBeenCalledWith(
      "/repo/robots/tim-e/tim-e.project.yaml"
    );
  });

  it("only applies the bootstrap-selected project once instead of reasserting it after manual changes", async () => {
    const view = render(<HomePage />);

    await waitFor(() => {
      expect(homePageMocks.selectProjectPath).toHaveBeenCalledWith(
        "/repo/robots/barr-e/barr-e.project.yaml"
      );
    });
    expect(homePageMocks.selectProjectPath).toHaveBeenCalledTimes(1);

    homePageMocks.state.projectPath = "/repo/robots/tim-e/tim-e.project.yaml";
    view.rerender(<HomePage />);

    await waitFor(() => {
      expect(homePageMocks.selectProjectPath).toHaveBeenCalledTimes(1);
    });
  });

  it("does not reapply the bootstrap-selected project after Home remounts", async () => {
    const firstMount = render(<HomePage />);

    await waitFor(() => {
      expect(homePageMocks.selectProjectPath).toHaveBeenCalledWith(
        "/repo/robots/barr-e/barr-e.project.yaml"
      );
    });
    expect(homePageMocks.selectProjectPath).toHaveBeenCalledTimes(1);

    homePageMocks.state.projectPath = "/repo/robots/tim-e/tim-e.project.yaml";
    firstMount.unmount();

    render(<HomePage />);

    await waitFor(() => {
      expect(homePageMocks.selectProjectPath).toHaveBeenCalledTimes(1);
    });
  });
});
