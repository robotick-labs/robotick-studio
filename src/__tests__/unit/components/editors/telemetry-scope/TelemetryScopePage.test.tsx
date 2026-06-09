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
import { PanelInstanceProvider } from "../../../../../renderer/components/workbenches/PanelInstanceContext";

function PanelHost({
  panelId,
  workbenchId,
  initialSettings = {},
  children,
}: {
  panelId: string;
  workbenchId: string;
  initialSettings?: Record<string, unknown>;
  children: React.ReactNode;
}) {
  const [settings, setSettings] = React.useState<Record<string, unknown>>(
    initialSettings
  );

  return (
    <>
      <PanelInstanceProvider
        panelId={panelId}
        workbenchId={workbenchId}
        settings={settings}
        setSettings={setSettings}
        updateSettings={(partial) =>
          setSettings((current) => ({ ...current, ...partial }))
        }
      >
        {children}
      </PanelInstanceProvider>
      <div data-testid={`settings-${panelId}`}>{JSON.stringify(settings)}</div>
    </>
  );
}

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

  it("preserves restored field trace selections in panel-owned settings", async () => {
    const initialSettings = {
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
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <PanelHost
            panelId="panel-a"
            workbenchId="workbench"
            initialSettings={initialSettings}
          >
            <TelemetryScopePage />
          </PanelHost>
        );
      });
      await settle();

      expect(container.querySelector("[data-testid='settings-panel-a']")?.textContent).toContain(
        '"modelPath":"models/demo.model.yaml"'
      );
      expect(container.querySelector("[data-testid='settings-panel-a']")?.textContent).toContain(
        '"workloadName":"alpha"'
      );
      expect(container.querySelector("[data-testid='settings-panel-a']")?.textContent).toContain(
        '"fieldPath":"alpha.outputs.speed"'
      );
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("restores generator traces without waiting for telemetry models", async () => {
    const initialSettings = {
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
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <PanelHost
            panelId="panel-a"
            workbenchId="workbench"
            initialSettings={initialSettings}
          >
            <TelemetryScopePage />
          </PanelHost>
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
      expect(container.querySelector("[data-testid='settings-panel-a']")?.textContent).toContain(
        '"sourceKind":"generator"'
      );
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

});
