import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useProject = vi.fn();
const useLauncher = vi.fn();
const useProjectData = vi.fn();
const useTelemetryService = vi.fn();

vi.mock("../../../../renderer/data-sources/launcher", () => ({
  Project: {
    Context: {
      use: () => useProject(),
    },
  },
  Launcher: {
    Context: {
      use: () => useLauncher(),
    },
  },
  ProjectData: {
    use: () => useProjectData(),
  },
}));

vi.mock(
  "../../../../renderer/data-sources/telemetry/internal/TelemetryService",
  () => ({
    useTelemetryService: () => useTelemetryService(),
  }),
);

vi.mock(
  "../../../../renderer/components/editors/telemetry/view/TelemetryModel",
  () => ({
    TelemetryModel: ({ model }: { model: { modelName: string } }) => (
      <div data-testid="telemetry-model" data-model-name={model.modelName}>
        {model.modelName}
      </div>
    ),
  }),
);

import { TelemetryApp } from "../../../../renderer/components/editors/telemetry/view/TelemetryApp";

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("TelemetryApp", () => {
  beforeEach(() => {
    useProject.mockReset();
    useLauncher.mockReset();
    useProjectData.mockReset();
    useTelemetryService.mockReset();

    useProject.mockReturnValue({ projectPath: "/tmp/mock-project" });
    useLauncher.mockReturnValue({ status: "running" });
    useTelemetryService.mockReturnValue({
      ensureLayout: vi.fn().mockResolvedValue(null),
      getLatestModel: vi.fn((baseUrl: string) => {
        if (baseUrl.includes("7101")) {
          return {
            process_memory_used: 100,
            workloads_buffer_size_used: 300,
          };
        }
        if (baseUrl.includes("7102")) {
          return {
            process_memory_used: 500,
            workloads_buffer_size_used: 100,
          };
        }
        return {
          process_memory_used: 200,
          workloads_buffer_size_used: 200,
        };
      }),
    });
    useProjectData.mockReturnValue({
      projectModels: {
        loading: false,
        error: null,
        data: [
          {
            modelName: "Zulu",
            modelPath: "robots/zulu.model.yaml",
            modelShortName: "zulu",
            telemetryBaseUrl: "http://example.test:7102",
            telemetryPushRateHz: 20,
            data: {},
          },
          {
            modelName: "Alpha",
            modelPath: "robots/alpha.model.yaml",
            modelShortName: "alpha",
            telemetryBaseUrl: "http://example.test:7101",
            telemetryPushRateHz: 20,
            data: {},
          },
          {
            modelName: "Mike",
            modelPath: "robots/mike.model.yaml",
            modelShortName: "mike",
            telemetryBaseUrl: "http://example.test:7103",
            telemetryPushRateHz: 20,
            data: {},
          },
        ],
      },
    });
  });

  it("sorts models by the selected panel-level key", () => {
    const tree = render(<TelemetryApp modelSortKey="telemetry_port" />);

    const initial = Array.from(
      tree.container.querySelectorAll("[data-testid='telemetry-model']"),
    ).map((entry) => entry.getAttribute("data-model-name"));
    expect(initial).toEqual(["Alpha", "Zulu", "Mike"]);

    act(() => {
      tree.unmount();
    });

    const treeByName = render(<TelemetryApp modelSortKey="model_name" />);
    const byName = Array.from(
      treeByName.container.querySelectorAll("[data-testid='telemetry-model']"),
    ).map((entry) => entry.getAttribute("data-model-name"));
    expect(byName).toEqual(["Alpha", "Mike", "Zulu"]);
    treeByName.unmount();

    const treeByProcess = render(<TelemetryApp modelSortKey="memory_process" />);
    const byProcess = Array.from(
      treeByProcess.container.querySelectorAll("[data-testid='telemetry-model']"),
    ).map((entry) => entry.getAttribute("data-model-name"));
    expect(byProcess).toEqual(["Zulu", "Mike", "Alpha"]);
    treeByProcess.unmount();
  });
});
