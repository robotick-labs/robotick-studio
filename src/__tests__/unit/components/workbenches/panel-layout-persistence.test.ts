import { describe, expect, it } from "vitest";
import {
  applyWorkbenchLayoutState,
  loadWorkbenchLayoutState,
  type PersistedPanelNode,
} from "../../../../renderer/components/workbenches/panel-layout-persistence";

describe("panel-layout-persistence floating panels", () => {
  it("writes floating panel settings and frame into the active layout resource", () => {
    const layoutNode: PersistedPanelNode = {
      id: "panel-1",
      kind: "leaf",
      editorId: "mock-editor",
      settings: { selectedField: "outputs.alpha" },
    };

    const model = applyWorkbenchLayoutState({
      workbenchId: "remote-control",
      workbenchLabel: "Remote Control",
      windowScope: "main",
      tabs: [
        {
          id: "default",
          name: "Remote Control | Default",
          layoutId: "main:remote-control:default",
        },
      ],
      activeTabId: "default",
      layoutNode,
      floatingPanels: [
        {
          id: "floating-1",
          editorId: "remote-control",
          label: "Remote Control Overlay",
          settings: {
            selectedStream: "Head-Depth",
          },
          frame: {
            x: 320,
            y: 180,
            width: 720,
            height: 480,
            minWidth: 360,
            minHeight: 240,
          },
        },
      ],
      fallbackEditorId: "mock-editor",
    });

    expect(model.windows[0]?.workbenches[0]?.layouts[0]).toMatchObject({
      id: "main:remote-control:default",
      floatingPanels: [
        {
          id: "floating-1",
          editorId: "remote-control",
          settings: {
            selectedStream: "Head-Depth",
          },
          frame: {
            x: 320,
            y: 180,
            width: 720,
            height: 480,
            minWidth: 360,
            minHeight: 240,
          },
        },
      ],
    });
  });

  it("loads floating panel settings and frame back from the studio document", () => {
    const state = loadWorkbenchLayoutState({
      model: {
        resourceType: "studio_document",
        schemaVersion: 1,
        id: "studio",
        windows: [
          {
            id: "main",
            label: "Main Window",
            windowRole: "main",
            defaultWorkbenchId: "remote-control",
            workbenches: [
              {
                id: "remote-control",
                label: "Remote Control",
                defaultLayoutId: "main:remote-control:default",
                layouts: [
                  {
                    id: "main:remote-control:default",
                    label: "Remote Control | Default",
                    dock: {
                      nodeType: "panel",
                      panelId: "panel-1",
                      editorId: "mock-editor",
                    },
                    floatingPanels: [
                      {
                        id: "floating-1",
                        editorId: "remote-control",
                        settings: {
                          selectedStream: "Head-Depth",
                        },
                        frame: {
                          x: 320,
                          y: 180,
                          width: 720,
                          height: 480,
                          minWidth: 360,
                          minHeight: 240,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      workbenchId: "remote-control",
      workbenchLabel: "Remote Control",
      windowScope: "main",
      fallbackEditorId: "mock-editor",
      allowedEditors: new Set(["mock-editor", "remote-control"]),
      createPanelId: () => "generated-panel",
    });

    expect(state.floatingPanels).toMatchObject([
      {
        id: "floating-1",
        editorId: "remote-control",
        settings: {
          selectedStream: "Head-Depth",
        },
        frame: {
          x: 320,
          y: 180,
          width: 720,
          height: 480,
          minWidth: 360,
          minHeight: 240,
        },
      },
    ]);
  });

  it("falls back unavailable editors and clears incompatible dock/floating settings on load", () => {
    const state = loadWorkbenchLayoutState({
      model: {
        resourceType: "studio_document",
        schemaVersion: 1,
        id: "studio",
        windows: [
          {
            id: "main",
            label: "Main Window",
            windowRole: "main",
            defaultWorkbenchId: "remote-control",
            workbenches: [
              {
                id: "remote-control",
                label: "Remote Control",
                defaultLayoutId: "main:remote-control:default",
                layouts: [
                  {
                    id: "main:remote-control:default",
                    label: "Remote Control | Default",
                    dock: {
                      nodeType: "panel",
                      panelId: "panel-1",
                      editorId: "missing-editor",
                      settings: {
                        stale: true,
                      },
                    },
                    floatingPanels: [
                      {
                        id: "floating-1",
                        editorId: "missing-editor",
                        label: "Missing Editor",
                        settings: {
                          stale: true,
                        },
                        frame: {
                          x: 10,
                          y: 20,
                          width: 300,
                          height: 200,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      workbenchId: "remote-control",
      workbenchLabel: "Remote Control",
      windowScope: "main",
      fallbackEditorId: "mock-editor",
      allowedEditors: new Set(["mock-editor"]),
      createPanelId: () => "generated-panel",
    });

    expect(state.activeLayout.dock).toMatchObject({
      nodeType: "panel",
      panelId: "panel-1",
      editorId: "mock-editor",
    });
    expect(
      state.activeLayout.dock.nodeType === "panel"
        ? state.activeLayout.dock.settings
        : undefined
    ).toBeUndefined();
    expect(state.floatingPanels).toMatchObject([
      {
        id: "floating-1",
        editorId: "mock-editor",
        frame: {
          x: 10,
          y: 20,
          width: 300,
          height: 200,
        },
      },
    ]);
    expect(state.floatingPanels[0]?.settings).toBeUndefined();
    expect(state.floatingPanels[0]?.label).toBeUndefined();
  });

  it("omits empty settings and empty floating panel lists from saved layouts", () => {
    const layoutNode: PersistedPanelNode = {
      id: "panel-1",
      kind: "leaf",
      editorId: "mock-editor",
      settings: {},
    };

    const model = applyWorkbenchLayoutState({
      workbenchId: "remote-control",
      workbenchLabel: "Remote Control",
      windowScope: "main",
      tabs: [
        {
          id: "default",
          name: "Remote Control | Default",
          layoutId: "main:remote-control:default",
        },
      ],
      activeTabId: "default",
      layoutNode,
      floatingPanels: [],
      fallbackEditorId: "mock-editor",
    });

    const layout = model.windows[0]?.workbenches[0]?.layouts[0];
    expect(layout?.floatingPanels).toBeUndefined();
    expect(
      layout?.dock.nodeType === "panel" ? layout.dock.settings : undefined
    ).toBeUndefined();
  });
});
