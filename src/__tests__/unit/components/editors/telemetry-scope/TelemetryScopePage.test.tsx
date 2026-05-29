import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ITelemetryField,
  ITelemetryModel,
  ITelemetryStruct,
  ITelemetryWorkload,
} from "../../../../../renderer/data-sources/telemetry";

if (typeof globalThis !== "undefined") {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

const projectModelsState = vi.hoisted(() => ({
  current: {
    data: [] as Array<{
      modelPath: string;
      modelName: string;
      telemetryBaseUrl: string;
      telemetryPushRateHz?: number;
    }>,
    loading: true,
    error: null as unknown,
  },
}));

const telemetryServiceState = vi.hoisted(() => ({
  model: null as ITelemetryModel | null,
  service: {
    ensureLayout: vi.fn(async () => telemetryServiceState.model),
    subscribeTelemetry: vi.fn(() => () => undefined),
  },
}));

vi.mock("../../../../../renderer/data-sources/launcher", () => ({
  ProjectData: {
    use: () => ({
      projectModels: projectModelsState.current,
    }),
  },
}));

vi.mock("../../../../../renderer/data-sources/telemetry", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../renderer/data-sources/telemetry")
  >("../../../../../renderer/data-sources/telemetry");
  return {
    ...actual,
    useTelemetryService: () => telemetryServiceState.service,
  };
});

import TelemetryScopePage from "../../../../../renderer/components/editors/telemetry-scope/TelemetryScopePage";
import { PanelInstanceProvider } from "../../../../../renderer/components/workspaces/PanelInstanceContext";

function createField(path: string): ITelemetryField {
  return {
    name: path.split(".").at(-1) ?? path,
    type: "float",
    path,
    offset: 0,
    elementCount: 1,
    getValue: () => 0,
  } as ITelemetryField;
}

function createStruct(fields: ITelemetryField[]): ITelemetryStruct {
  return {
    typeName: "struct",
    offset: 0,
    fields,
  };
}

function createTelemetryModel(): ITelemetryModel {
  const field = createField("alpha.outputs.speed");
  return {
    schemaSessionId: "session-1",
    raw: null,
    workloads_buffer_size_used: 0,
    process_memory_used: 0,
    workloads: [
      {
        name: "alpha",
        tickRateHz: 30,
        outputs: createStruct([field]),
      } as ITelemetryWorkload,
    ],
    getField: (path: string) =>
      path === field.path ? field : null,
  } as ITelemetryModel;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("TelemetryScopePage restore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    projectModelsState.current = {
      data: [],
      loading: true,
      error: null,
    };
    telemetryServiceState.model = createTelemetryModel();
    telemetryServiceState.service.ensureLayout.mockClear();
    telemetryServiceState.service.subscribeTelemetry.mockClear();
    vi.clearAllMocks();
  });

  it("preserves restored trace selections until models and layouts are available", async () => {
    const storageKey = "robotick-studio.telemetry-scope.panel.workspace.panel-a";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        traces: [
          {
            id: "trace-1",
            modelPath: "models/demo.model.yaml",
            workloadName: "alpha",
            section: "outputs",
            fieldPath: "alpha.outputs.speed",
            visible: true,
            color: "#7ef9a9",
            scale: "1",
            offset: "0",
          },
        ],
        windowSeconds: 10,
        freeze: false,
        yMode: "auto",
        yMin: "-1",
        yMax: "1",
        showGrid: true,
        showLegend: true,
        showLatestValues: true,
        fieldsExpanded: true,
        settingsExpanded: false,
      })
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <PanelInstanceProvider panelId="panel-a" workspaceId="workspace">
            <TelemetryScopePage />
          </PanelInstanceProvider>
        );
      });
      await settle();

      expect(window.localStorage.getItem(storageKey)).toContain(
        '"modelPath":"models/demo.model.yaml"'
      );
      expect(window.localStorage.getItem(storageKey)).toContain(
        '"workloadName":"alpha"'
      );
      expect(window.localStorage.getItem(storageKey)).toContain(
        '"fieldPath":"alpha.outputs.speed"'
      );

      projectModelsState.current = {
        data: [
          {
            modelPath: "models/demo.model.yaml",
            modelName: "Demo Model",
            telemetryBaseUrl: "http://example.test",
            telemetryPushRateHz: 20,
          },
        ],
        loading: false,
        error: null,
      };

      await act(async () => {
        root.render(
          <PanelInstanceProvider panelId="panel-a" workspaceId="workspace">
            <TelemetryScopePage />
          </PanelInstanceProvider>
        );
      });
      await settle();

      const selects = Array.from(container.querySelectorAll("select"));
      expect(selects).toHaveLength(4);
      expect((selects[0] as HTMLSelectElement).value).toBe(
        "models/demo.model.yaml"
      );
      expect((selects[1] as HTMLSelectElement).value).toBe("alpha");
      expect((selects[2] as HTMLSelectElement).value).toBe("outputs");
      expect((selects[3] as HTMLSelectElement).value).toBe(
        "alpha.outputs.speed"
      );
      expect(container.textContent).toContain("Sync All Fields");
      expect(container.textContent).toContain("Sync All");
      expect(container.textContent).toContain("Fit Y");
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("restores generator traces without waiting for telemetry models", async () => {
    const storageKey = "robotick-studio.telemetry-scope.panel.workspace.panel-a";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        traces: [
          {
            id: "trace-generator-1",
            sourceKind: "generator",
            waveShape: "square",
            frequencyHz: "2.5",
            visible: true,
            color: "#73c7ff",
            scale: "1",
            offset: "0",
          },
        ],
        windowSeconds: 10,
        freeze: false,
        yMode: "auto",
        yMin: "-1",
        yMax: "1",
        showGrid: true,
        showLegend: true,
        showLatestValues: true,
        fieldsExpanded: true,
        settingsExpanded: false,
      })
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <PanelInstanceProvider panelId="panel-a" workspaceId="workspace">
            <TelemetryScopePage />
          </PanelInstanceProvider>
        );
      });
      await settle();

      const selects = Array.from(container.querySelectorAll("select"));
      expect(selects).toHaveLength(1);
      expect((selects[0] as HTMLSelectElement).value).toBe("square");

      const inputs = Array.from(container.querySelectorAll("input"));
      const frequencyInput = inputs.find(
        (input) => (input as HTMLInputElement).type === "number"
      ) as HTMLInputElement | undefined;
      expect(frequencyInput?.value).toBe("2.5");

      expect(container.textContent).toContain("square 2.5 Hz");
      expect(window.localStorage.getItem(storageKey)).toContain(
        '"sourceKind":"generator"'
      );
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("continues plotting restored field traces when telemetry samples arrive", async () => {
    const storageKey = "robotick-studio.telemetry-scope.panel.workspace.panel-a";
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        traces: [
          {
            id: "trace-1",
            modelPath: "models/demo.model.yaml",
            workloadName: "alpha",
            section: "outputs",
            fieldPath: "alpha.outputs.speed",
            visible: true,
            color: "#7ef9a9",
            scale: "1",
            offset: "0",
          },
        ],
        windowSeconds: 10,
        freeze: false,
        yMode: "auto",
        yMin: "-1",
        yMax: "1",
        showGrid: true,
        showLegend: true,
        showLatestValues: true,
        fieldsExpanded: true,
        settingsExpanded: false,
      })
    );

    projectModelsState.current = {
      data: [
        {
          modelPath: "models/demo.model.yaml",
          modelName: "Demo Model",
          telemetryBaseUrl: "http://example.test",
          telemetryPushRateHz: 20,
        },
      ],
      loading: false,
      error: null,
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <PanelInstanceProvider panelId="panel-a" workspaceId="workspace">
            <TelemetryScopePage />
          </PanelInstanceProvider>
        );
      });
      await settle();

      const subscribeCall = telemetryServiceState.service.subscribeTelemetry.mock.calls[0];
      expect(subscribeCall).toBeDefined();
      const subscription = subscribeCall?.[2] as
        | { callback?: (model: ITelemetryModel) => void }
        | undefined;
      expect(subscription?.callback).toBeTypeOf("function");

      await act(async () => {
        subscription?.callback?.(telemetryServiceState.model as ITelemetryModel);
        subscription?.callback?.(telemetryServiceState.model as ITelemetryModel);
      });
      await settle();

      const text = container.textContent ?? "";
      expect(text).not.toContain("Waiting for telemetry schema...");
      expect(text).not.toContain("No compatible scalar fields in the selected scope.");
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
