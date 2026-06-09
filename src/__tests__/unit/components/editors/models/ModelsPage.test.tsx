import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initNodeGraphMock = vi.hoisted(() =>
  vi.fn(() => ({
    dispose: vi.fn(),
    refreshLayout: vi.fn(async () => {}),
    setModelSortKey: vi.fn(),
    setCollapsedModelIds: vi.fn(),
    setDisplayOptions: vi.fn(),
    getDoc: () => ({
      sections: [],
      getNode: () => undefined,
      bounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
    }),
  })),
);
const initPropertyPanelMock = vi.hoisted(() =>
  vi.fn(() => ({
    render: vi.fn(),
    dispose: vi.fn(),
  })),
);
const loadMock = vi.hoisted(() => vi.fn(async () => {}));
const getModelIdsMock = vi.hoisted(() => vi.fn(() => ["model-a"]));

vi.mock(
  "../../../../../renderer/components/editors/models/view/node-graph/initNodeGraph",
  () => ({
    initNodeGraph: initNodeGraphMock,
  }),
);

vi.mock(
  "../../../../../renderer/components/editors/models/view/properties/InitPropertyPanel",
  () => ({
    initPropertyPanel: initPropertyPanelMock,
  }),
);

vi.mock(
  "../../../../../renderer/components/editors/models/document/documentStore",
  () => ({
    DocumentStore: class {
      load = loadMock;
      getModelIds = getModelIdsMock;
    },
  }),
);

vi.mock("../../../../../renderer/data-sources/launcher", async () => {
  const actual = await vi.importActual<object>(
    "../../../../../renderer/data-sources/launcher",
  );
  return {
    ...actual,
    Project: {
      Context: {
        use: () => ({
          projectPath: "/tmp/models.project.yaml",
        }),
      },
    },
  };
});

import ModelsPage from "../../../../../renderer/components/editors/models/ModelsPage";
import { PanelInstanceProvider } from "../../../../../renderer/components/workbenches/PanelInstanceContext";

function PanelHost({
  children,
  initialSettings = {},
}: {
  children: React.ReactNode;
  initialSettings?: Record<string, unknown>;
}) {
  const [settings, setSettings] = React.useState<Record<string, unknown>>(initialSettings);
  const setPanelSettings = React.useCallback(
    (nextSettings: Record<string, unknown>) => setSettings(nextSettings),
    [],
  );
  const updatePanelSettings = React.useCallback(
    (partial: Record<string, unknown>) =>
      setSettings((current) => ({ ...current, ...partial })),
    [],
  );

  return (
    <>
      <PanelInstanceProvider
        panelId="models-panel"
        workbenchId="workbench"
        editorId="models"
        settings={settings}
        setSettings={setPanelSettings}
        updateSettings={updatePanelSettings}
      >
        {children}
      </PanelInstanceProvider>
      <div data-testid="settings">{JSON.stringify(settings)}</div>
    </>
  );
}

describe("ModelsPage", () => {
  beforeEach(() => {
    initNodeGraphMock.mockClear();
    initPropertyPanelMock.mockClear();
    loadMock.mockClear();
    getModelIdsMock.mockClear();
    Object.defineProperty(SVGSVGElement.prototype, "getBBox", {
      configurable: true,
      value: vi.fn(
        () => ({ x: 0, y: 0, width: 100, height: 100 }) as SVGRect,
      ),
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 600,
      bottom: 300,
      left: 0,
      width: 600,
      height: 300,
      toJSON: () => ({}),
    } as DOMRect);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not reinitialize the property panel when startup viewport persistence updates panel settings", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelHost>
          <ModelsPage />
        </PanelHost>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(initNodeGraphMock).toHaveBeenCalledTimes(1);
    expect(initPropertyPanelMock).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector("[data-testid='settings']")?.textContent,
    ).toContain("\"viewport\"");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(initNodeGraphMock).toHaveBeenCalledTimes(1);
    expect(initPropertyPanelMock).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("replaces a stored viewport that does not include the selected node", async () => {
    initNodeGraphMock.mockReturnValueOnce({
      dispose: vi.fn(),
      refreshLayout: vi.fn(async () => {}),
      setModelSortKey: vi.fn(),
      setCollapsedModelIds: vi.fn(),
      setDisplayOptions: vi.fn(),
      getDoc: () => ({
        sections: [],
        getNode: () => ({
          id: "model-a:__model__",
          x: 1200,
          y: 80,
          w: 160,
          h: 40,
        }),
        bounds: () => ({ x: 0, y: 0, w: 1600, h: 300 }),
      }),
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelHost
          initialSettings={{
            viewState: {
              edgeVisibilityMode: "selected-model",
              remoteConnectionVisibility: "hidden",
              selectedNodeId: "model-a:__model__",
              showPropertyPanel: true,
              collapsedModelIds: [],
            },
            modelSortKey: "model_path",
            viewport: {
              x: -400,
              y: -400,
              width: 300,
              height: 300,
            },
          }}
        >
          <ModelsPage />
        </PanelHost>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-testid='settings']")?.textContent,
    ).toContain("\"width\":1500");
    expect(
      container.querySelector("[data-testid='settings']")?.textContent,
    ).not.toContain("\"width\":300");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
