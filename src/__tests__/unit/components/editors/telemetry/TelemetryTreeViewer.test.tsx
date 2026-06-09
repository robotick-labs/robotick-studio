import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ITelemetryField,
  ITelemetryModel,
  ITelemetryStruct,
  ITelemetryWorkload,
} from "../../../../../renderer/data-sources/telemetry";
import { FloatingPanelsScopeProvider } from "../../../../../renderer/components/workspaces/floating-panels";
import { PanelInstanceProvider } from "../../../../../renderer/components/workspaces/PanelInstanceContext";

const telemetryModel = vi.hoisted(() => ({
  current: null as ITelemetryModel | null,
}));

vi.mock("../../../../../renderer/data-sources/launcher", () => ({
  ProjectData: {
    use: () => ({
      projectModels: {
        data: [
          {
            modelPath: "models/demo.model.yaml",
            modelShortName: "demo",
            modelName: "Demo Model",
            telemetryBaseUrl: "http://example.test",
            data: {},
          },
        ],
        loading: false,
        error: null,
      },
    }),
  },
}));

vi.mock("../../../../../renderer/data-sources/telemetry", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../renderer/data-sources/telemetry")
  >("../../../../../renderer/data-sources/telemetry");
  return {
    ...actual,
    useTelemetryStream: () => ({
      model: telemetryModel.current,
      revision: 1,
    }),
  };
});

import TelemetryTreeViewer from "../../../../../renderer/components/editors/telemetry/tree-viewer/TelemetryTreeViewer";

function createField(
  model: ITelemetryModel,
  workloadName: string,
  sectionName: string,
  name: string
): ITelemetryField {
  return {
    name,
    type: "float",
    path: `${workloadName}.${sectionName}.${name}`,
    offset: 0,
    elementCount: 1,
    model,
    getValue: () => 0,
  };
}

function createStruct(fields: ITelemetryField[]): ITelemetryStruct {
  return {
    typeName: "struct",
    offset: 0,
    fields,
  };
}

function createModel(): ITelemetryModel {
  const model = {
    schemaSessionId: "session-1",
    raw: null,
    workloads: [] as ITelemetryWorkload[],
    workloads_buffer_size_used: 0,
    process_memory_used: 0,
  } as ITelemetryModel;
  model.workloads = [
    {
      name: "alpha",
      tickRateHz: 30,
      outputs: createStruct([
        createField(model, "alpha", "outputs", "alpha_output"),
      ]),
    } as ITelemetryWorkload,
    {
      name: "beta",
      tickRateHz: 30,
      outputs: createStruct([
        createField(model, "beta", "outputs", "beta_output"),
      ]),
    } as ITelemetryWorkload,
  ];
  return model;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderViewer(root: ReturnType<typeof createRoot>) {
  function TestPanelHost({ children }: { children: React.ReactNode }) {
    const [settings, setSettings] = React.useState<Record<string, unknown>>({});

    return (
      <PanelInstanceProvider
        panelId="test-panel"
        workspaceId="test-workspace"
        editorId="telemetry-tree"
        settings={settings}
        setSettings={setSettings}
        updateSettings={(partial) =>
          setSettings((current) => ({ ...current, ...partial }))
        }
      >
        {children}
      </PanelInstanceProvider>
    );
  }

  root.render(
    <FloatingPanelsScopeProvider scope="test-floating-panels">
      <TestPanelHost>
        <TelemetryTreeViewer />
      </TestPanelHost>
    </FloatingPanelsScopeProvider>
  );
}

describe("TelemetryTreeViewer workload filtering", () => {
  beforeEach(() => {
    telemetryModel.current = createModel();
    window.localStorage.clear();
  });

  afterEach(() => {
    telemetryModel.current = null;
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps All Workloads selected and renders workload roots", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        renderViewer(root);
      });
      await settle();

      const workloadSelect = container.querySelector<HTMLSelectElement>(
        "#tree-workload"
      );
      expect(workloadSelect?.value).toBe("");
      expect(container.textContent).toContain("alpha:");
      expect(container.textContent).toContain("beta:");

      const alphaToggle = Array.from(container.querySelectorAll("button")).find(
        (button) => button.parentElement?.textContent?.includes("alpha:")
      );
      expect(alphaToggle).toBeDefined();

      await act(async () => {
        alphaToggle?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
      });
      expect(container.textContent).toContain("Outputs:");
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("filters to the selected workload while keeping it as the root node", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        renderViewer(root);
      });
      await settle();

      const workloadSelect = container.querySelector<HTMLSelectElement>(
        "#tree-workload"
      );
      expect(workloadSelect).not.toBeNull();

      await act(async () => {
        workloadSelect!.value = "beta";
        workloadSelect!.dispatchEvent(
          new Event("change", { bubbles: true, cancelable: true })
        );
      });
      await settle();

      expect(workloadSelect!.value).toBe("beta");
      expect(container.textContent).not.toContain("alpha:");
      expect(container.textContent).toContain("beta:");

      const betaToggle = Array.from(container.querySelectorAll("button")).find(
        (button) => button.parentElement?.textContent?.includes("beta:")
      );
      expect(betaToggle).toBeDefined();

      await act(async () => {
        betaToggle?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
      });
      await settle();

      expect(container.textContent).toContain("Outputs:");

      const outputsToggle = Array.from(container.querySelectorAll("button")).find(
        (button) => button.parentElement?.textContent?.includes("Outputs:")
      );
      expect(outputsToggle).toBeDefined();

      await act(async () => {
        outputsToggle?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
      });
      await settle();

      expect(container.textContent).toContain("beta_output:");
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("shows a tree-item context menu that filters to the clicked item", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        renderViewer(root);
      });
      await settle();

      const workloadSelect = container.querySelector<HTMLSelectElement>(
        "#tree-workload"
      );
      const sectionSelect = container.querySelector<HTMLSelectElement>(
        "#tree-section"
      );
      const fieldInput = container.querySelector<HTMLInputElement>("#tree-field");
      expect(workloadSelect).not.toBeNull();
      expect(sectionSelect).not.toBeNull();
      expect(fieldInput).not.toBeNull();

      await act(async () => {
        workloadSelect!.value = "beta";
        workloadSelect!.dispatchEvent(
          new Event("change", { bubbles: true, cancelable: true })
        );
      });
      await settle();

      const betaToggle = Array.from(container.querySelectorAll("button")).find(
        (button) => button.parentElement?.textContent?.includes("beta:")
      );
      expect(betaToggle).toBeDefined();

      await act(async () => {
        betaToggle?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
      });
      await settle();

      const outputsToggle = Array.from(container.querySelectorAll("button")).find(
        (button) => button.parentElement?.textContent?.includes("Outputs:")
      );
      expect(outputsToggle).toBeDefined();

      await act(async () => {
        outputsToggle?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
      });
      await settle();

      const betaOutputRow = Array.from(
        container.querySelectorAll<HTMLElement>(
          "[data-testid='telemetry-tree-row']"
        )
      ).find((row) => row.textContent?.includes("beta_output:"));
      expect(betaOutputRow).toBeDefined();

      await act(async () => {
        betaOutputRow!.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 110,
            clientY: 70,
          })
        );
      });
      await settle();

      expect(container.textContent).not.toContain("Filter To Item");

      const betaOutputText = Array.from(
        container.querySelectorAll<HTMLElement>(
          "[data-testid='telemetry-tree-node-text']"
        )
      ).find((row) => row.textContent?.includes("beta_output:"));
      expect(betaOutputText).toBeDefined();

      await act(async () => {
        betaOutputText!.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 120,
            clientY: 80,
          })
        );
      });
      await settle();

      const filterButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Filter To Item"
      );
      expect(filterButton).toBeDefined();

      await act(async () => {
        filterButton!.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
      });
      await settle();

      expect(workloadSelect!.value).toBe("beta");
      expect(sectionSelect!.value).toBe("outputs");
      expect(fieldInput!.value).toBe("beta_output");
      expect(container.textContent).not.toContain("Filter To Item");
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
