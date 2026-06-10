import { describe, expect, it } from "vitest";
import type { StudioDocument } from "../../main/studio-persistence";
import {
  buildStudioRuntimeTree,
  resolveStudioRuntimeNode,
} from "../../main/studio-control/studio-context-resolver";

const document: StudioDocument = {
  resourceType: "studio_document",
  schemaVersion: 1,
  id: "test-studio",
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
          path: "/remote-control",
          group: "test",
          defaultEditorId: "remote-control",
          defaultLayoutId: "main:remote-control:default",
          layouts: [
            {
              id: "main:remote-control:default",
              label: "Remote Control | Default",
              dock: {
                nodeType: "panel",
                panelId: "panel-remote-control",
                editorId: "remote-control",
              },
              floatingPanels: [
                {
                  id: "panel-camera",
                  editorId: "streaming-image-viewer",
                  settings: { source: "face-camera" },
                  frame: { x: 10, y: 20, width: 320, height: 240 },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("Studio control runtime status", () => {
  it("returns node-local instance status with neutral child metadata", () => {
    const tree = buildStudioRuntimeTree(document, {
      instanceName: "studio-1234",
      pid: 1234,
      mode: "dev",
      selectedProjectPath: "/tmp/project",
      workspaceRoot: "/tmp/workspace",
      activeWindowScope: "main",
      openWindowScopes: ["main"],
    });

    const status = resolveStudioRuntimeNode(tree, []);

    expect(status).toMatchObject({
      resource_type: "studio_instance",
      id: "studio-1234",
      active_window_id: "main",
      state_sources: { active_window_id: "runtime" },
      child_collections: [
        { name: "windows", resource_type: "studio_windows", item_count: 1 },
      ],
    });
    expect(status?.children?.windows?.[0]).toMatchObject({
      resource_type: "studio_window",
      id: "main",
      label: "Main Window",
    });
  });

  it("resolves deep panel status from the Studio-owned tree", () => {
    const tree = buildStudioRuntimeTree(document, {
      instanceName: "studio-1234",
      pid: 1234,
      mode: "dev",
      selectedProjectPath: "/tmp/project",
      workspaceRoot: "/tmp/workspace",
      activeWindowScope: "main",
      openWindowScopes: ["main"],
    });

    const status = resolveStudioRuntimeNode(tree, [
      "windows",
      "main",
      "workbenches",
      "remote-control",
      "layouts",
      "main:remote-control:default",
      "panels",
      "panel-camera",
    ]);

    expect(status).toMatchObject({
      resource_type: "studio_panel",
      id: "panel-camera",
      panel_location: "floating",
      editor_id: "streaming-image-viewer",
      settings: { source: "face-camera" },
    });
  });
});
