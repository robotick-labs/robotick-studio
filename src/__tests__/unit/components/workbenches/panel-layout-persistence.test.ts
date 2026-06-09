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
});
