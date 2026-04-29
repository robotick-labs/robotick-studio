import React from "react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";

if (typeof globalThis !== "undefined") {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

const fetchProjectWorkloadsRegistryMock = vi.hoisted(() => vi.fn());
const fetchProjectCoreModelSchemaMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../renderer/data-sources/launcher", () => ({
  launcherService: {
    fetchProjectWorkloadsRegistry: fetchProjectWorkloadsRegistryMock,
    fetchProjectCoreModelSchema: fetchProjectCoreModelSchemaMock,
  },
}));

import { PropertyPanel } from "../../../../../renderer/components/editors/models/view/properties/PropertyPanel";
import { DocumentStore } from "../../../../../renderer/components/editors/models/document/documentStore";
import { editorSelectionStore } from "../../../../../renderer/components/editors/models/document/editorSelectionStore";

describe("PropertyPanel Phase 2A", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchProjectCoreModelSchemaMock.mockResolvedValue({
      type: "object",
      properties: {
        name: { type: "string" },
        root: { type: ["string", "object"] },
        telemetry: { type: "object" },
        connections: { type: "array" },
        remote_models: { type: "array" },
        workloads: { type: "array" },
      },
    });
    editorSelectionStore.setSelection(null, "test-scope");
  });

  it("renders schema-backed config/inputs/outputs and refreshes metadata on demand", async () => {
    fetchProjectWorkloadsRegistryMock.mockResolvedValue({
      project: "/tmp/nested.project.yaml",
      target: "linux",
      registry: [
        {
          type: "SampleWorkload",
          metadata: {
            structs: {
              config: {
                fields: [{ name: "enabled", type: "bool", default: "true" }],
              },
              inputs: {
                fields: [{ name: "gain", type: "float" }],
              },
              outputs: {
                fields: [{ name: "ready", type: "bool" }],
              },
            },
          },
        },
      ],
    });

    const store = new DocumentStore();
    (store as any).models.set("models/sample.model.yaml", {
      root: "node",
      workloads: [
        {
          name: "node",
          type: "SampleWorkload",
          tick_rate_hz: 30,
          config: { enabled: true },
          inputs: { gain: 0.5 },
          outputs: { ready: false },
        },
      ],
      connections: [],
      remote_models: [],
    });

    const container = document.createElement("div");
    const root = createRoot(container);

    editorSelectionStore.setSelection("sample:node", "test-scope");

    await act(async () => {
      root.render(
        <PropertyPanel
          store={store}
          selectionScope="test-scope"
          projectPath="/tmp/nested.project.yaml"
        />
      );
      await Promise.resolve();
    });

    expect(fetchProjectWorkloadsRegistryMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Properties");
    expect(container.textContent).toContain("Config");
    expect(container.textContent).toContain("Inputs");
    expect(container.textContent).toContain("Outputs");
    expect(container.textContent).toContain("enabled");
    expect(container.textContent).toContain("gain");
    expect(container.textContent).toContain("ready");
    const revertReady = container.querySelector(
      "button[aria-label='Revert ready']"
    ) as HTMLButtonElement | null;
    expect(revertReady).not.toBeNull();

    const refreshButton = container.querySelector(
      "button[aria-label='Refresh metadata']"
    ) as HTMLButtonElement | null;
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.click();
      await Promise.resolve();
    });
    expect(fetchProjectWorkloadsRegistryMock).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
  });

  it("shows registry fallback for unset values and reverts overrides", async () => {
    fetchProjectWorkloadsRegistryMock.mockResolvedValue({
      project: "/tmp/revert.project.yaml",
      target: "linux",
      registry: [
        {
          type: "SampleWorkload",
          metadata: {
            structs: {
              config: {
                fields: [
                  { name: "enabled", type: "bool", default: "true" },
                  { name: "nickname", type: "std::string" },
                ],
              },
              inputs: {
                fields: [{ name: "gain", type: "float" }],
              },
              outputs: {
                fields: [{ name: "ready", type: "bool", default: "false" }],
              },
            },
          },
        },
      ],
    });

    const store = new DocumentStore();
    (store as any).models.set("models/sample.model.yaml", {
      root: "node",
      workloads: [
        {
          name: "node",
          type: "SampleWorkload",
          tick_rate_hz: 30,
          config: { enabled: false },
          inputs: { gain: 0.5 },
          outputs: {},
        },
      ],
      connections: [],
      remote_models: [],
    });

    const container = document.createElement("div");
    const root = createRoot(container);
    editorSelectionStore.setSelection("sample:node", "test-scope");

    await act(async () => {
      root.render(
        <PropertyPanel
          store={store}
          selectionScope="test-scope"
          projectPath="/tmp/revert.project.yaml"
        />
      );
      await Promise.resolve();
    });

    const enabledInput = container.querySelector(
      "input[data-prop='enabled']"
    ) as HTMLInputElement | null;
    const readyInput = container.querySelector(
      "input[data-prop='ready']"
    ) as HTMLInputElement | null;
    const nicknameInput = container.querySelector(
      "input[data-prop='nickname']"
    ) as HTMLInputElement | null;
    const gainInput = container.querySelector(
      "input[data-prop='gain']"
    ) as HTMLInputElement | null;

    expect(enabledInput?.value).toBe("false");
    expect(readyInput?.value).toBe("false");
    expect(nicknameInput?.value).toBe("default not available");
    expect(gainInput?.value).toBe("0.5");

    const revertGain = container.querySelector(
      "button[aria-label='Revert gain']"
    ) as HTMLButtonElement | null;
    expect(revertGain).not.toBeNull();
    expect(revertGain?.disabled).toBe(true);

    await act(async () => {
      revertGain?.click();
      await Promise.resolve();
    });

    const gainAfterRevert = container.querySelector(
      "input[data-prop='gain']"
    ) as HTMLInputElement | null;
    expect(gainAfterRevert?.value).toBe("0.5");
    expect(revertGain?.disabled).toBe(true);

    act(() => root.unmount());
  });

  it("renders and validates nested struct/array values from registry metadata", async () => {
    fetchProjectWorkloadsRegistryMock.mockResolvedValue({
      project: "/tmp/validation.project.yaml",
      target: "linux",
      registry: [
        {
          type: "SampleWorkload",
          metadata: {
            structs: {
              config: {
                fields: [{ name: "position", type: "Vec2" }],
              },
              Vec2: {
                fields: [
                  { name: "x", type: "float" },
                  { name: "y", type: "float" },
                ],
              },
              outputs: {
                fields: [{ name: "points", type: "std::vector<Vec2>" }],
              },
            },
          },
        },
      ],
    });

    const store = new DocumentStore();
    (store as any).models.set("models/sample.model.yaml", {
      root: "node",
      workloads: [
        {
          name: "node",
          type: "SampleWorkload",
          tick_rate_hz: 30,
          config: { position: { x: 1.1, y: "oops" } },
          inputs: {},
          outputs: { points: [{ x: 2, y: 3 }, { x: "bad", y: 4 }] },
        },
      ],
      connections: [],
      remote_models: [],
    });

    const container = document.createElement("div");
    const root = createRoot(container);
    editorSelectionStore.setSelection("sample:node", "test-scope");

    await act(async () => {
      root.render(
        <PropertyPanel
          store={store}
          selectionScope="test-scope"
          projectPath="/tmp/validation.project.yaml"
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("x");
    expect(container.textContent).toContain("y");
    expect(container.textContent).toContain("Wrong type for config.position.y");
    expect(container.textContent).toContain("Wrong type for outputs.points[1].x");

    act(() => root.unmount());
  });

  it("shows schema/yaml validation errors for unknown fields and wrong types", async () => {
    fetchProjectWorkloadsRegistryMock.mockResolvedValue({
      project: "/tmp/sample.project.yaml",
      target: "linux",
      registry: [
        {
          type: "SampleWorkload",
          metadata: {
            structs: {
              config: {
                fields: [{ name: "enabled", type: "bool" }],
              },
            },
          },
        },
      ],
    });

    const store = new DocumentStore();
    (store as any).models.set("models/sample.model.yaml", {
      root: "node",
      workloads: [
        {
          name: "node",
          type: "SampleWorkload",
          tick_rate_hz: 30,
          config: { enabled: "yes", unknown_key: 42 },
          inputs: {},
          outputs: {},
        },
      ],
      connections: [],
      remote_models: [],
    });

    const container = document.createElement("div");
    const root = createRoot(container);
    editorSelectionStore.setSelection("sample:node", "test-scope");

    await act(async () => {
      root.render(
        <PropertyPanel
          store={store}
          selectionScope="test-scope"
          projectPath="/tmp/sample.project.yaml"
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Schema/YAML Errors");
    expect(container.textContent).toContain("Unknown config field in YAML");
    expect(container.textContent).toContain("Wrong type for config.enabled");

    act(() => root.unmount());
  });
});
