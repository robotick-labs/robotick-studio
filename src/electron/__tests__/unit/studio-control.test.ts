import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import type { StudioDocument } from "../../main/studio-persistence";
import {
  buildStudioRuntimeTree,
  resolveStudioRuntimeNode,
} from "../../main/studio-control/studio-context-resolver";
import { routeStudioControlRequest } from "../../main/studio-control/studio-control-routes";

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
        {
          id: "models",
          label: "Models",
          path: "/models",
          group: "dev",
          defaultEditorId: "models",
          defaultLayoutId: "main:models:default",
          layouts: [
            {
              id: "main:models:default",
              label: "Models | Default",
              dock: {
                nodeType: "panel",
                panelId: "panel-models",
                editorId: "models",
              },
            },
          ],
        },
      ],
    },
  ],
};

function writeStudioDocumentFixture(projectPath: string) {
  fs.mkdirSync(path.join(projectPath, "studio"), { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, "studio", "studio.yaml"),
    [
      "resourceType: studio_document",
      "schemaVersion: 1",
      "id: test-studio",
      "windows:",
      "  - id: main",
      "    label: Main Window",
      "    windowRole: main",
      "    defaultWorkbenchId: remote-control",
      "    workbenches:",
      "      - id: remote-control",
      "        label: Remote Control",
      "        path: /remote-control",
      "        defaultEditorId: remote-control",
      "        layouts:",
      "          - id: main:remote-control:default",
      "            label: Remote Control | Default",
      "            dock:",
      "              nodeType: panel",
      "              panelId: panel-remote-control",
      "              editorId: remote-control",
      "      - id: models",
      "        label: Models",
      "        path: /models",
      "        defaultEditorId: models",
      "        layouts:",
      "          - id: main:models:default",
      "            label: Models | Default",
      "            dock:",
      "              nodeType: panel",
      "              panelId: panel-models",
      "              editorId: models",
    ].join("\n"),
    "utf-8"
  );
}

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
      active: false,
      activatable: false,
      activation_target_path: null,
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

  it("derives selected project metadata from the live project path", () => {
    const selectedProjectPath = "/tmp/robots/pip-e/pip-e.project.yaml";
    const tree = buildStudioRuntimeTree(document, {
      instanceName: "studio-1234",
      pid: 1234,
      mode: "dev",
      selectedProjectPath,
      workspaceRoot: "/tmp/workspace",
      activeWindowScope: "main",
      openWindowScopes: ["main"],
    });

    const status = resolveStudioRuntimeNode(tree, []);

    expect(status).toMatchObject({
      resource_type: "studio_instance",
      project_name: "pip-e",
      project_dir: "/tmp/robots/pip-e",
      selected_project_path: selectedProjectPath,
    });
  });

  it("does not mark configured default workbench as active without live state", () => {
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
    ]);

    expect(status).toMatchObject({
      resource_type: "studio_workbench",
      id: "remote-control",
      active: false,
      activatable: true,
      activation_target_path: ["windows", "main", "workbenches", "remote-control"],
      state_sources: {
        active_layout_id: "unknown",
      },
    });
  });

  it("uses live active workbench state instead of the configured default", () => {
    const tree = buildStudioRuntimeTree(document, {
      instanceName: "studio-1234",
      pid: 1234,
      mode: "dev",
      selectedProjectPath: "/tmp/project",
      workspaceRoot: "/tmp/workspace",
      activeWindowScope: "main",
      openWindowScopes: ["main"],
      activeWorkbenchIds: { main: "models" },
    });

    const defaultWorkbenchStatus = resolveStudioRuntimeNode(tree, [
      "windows",
      "main",
      "workbenches",
      "remote-control",
    ]);
    const liveWorkbenchStatus = resolveStudioRuntimeNode(tree, [
      "windows",
      "main",
      "workbenches",
      "models",
    ]);

    expect(defaultWorkbenchStatus).toMatchObject({
      resource_type: "studio_workbench",
      id: "remote-control",
      active: false,
    });
    expect(liveWorkbenchStatus).toMatchObject({
      resource_type: "studio_workbench",
      id: "models",
      active: true,
      activation_target_path: ["windows", "main", "workbenches", "models"],
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
      active: false,
      activatable: true,
      activation_target_path: [
        "windows",
        "main",
        "workbenches",
        "remote-control",
        "layouts",
        "main:remote-control:default",
        "panels",
        "panel-camera",
      ],
    });
  });

  it("reports activation metadata for resource and collection contexts", () => {
    const tree = buildStudioRuntimeTree(document, {
      instanceName: "studio-1234",
      pid: 1234,
      mode: "dev",
      selectedProjectPath: "/tmp/project",
      workspaceRoot: "/tmp/workspace",
      activeWindowScope: "main",
      openWindowScopes: ["main"],
      activeWorkbenchIds: { main: "remote-control" },
      activeLayoutIds: { "main/remote-control": "main:remote-control:default" },
      activePanelIds: {
        "main/remote-control/main:remote-control:default": "panel-camera",
      },
    });

    const workbenchStatus = resolveStudioRuntimeNode(tree, [
      "windows",
      "main",
      "workbenches",
      "remote-control",
    ]);
    expect(workbenchStatus).toMatchObject({
      resource_type: "studio_workbench",
      id: "remote-control",
      active: true,
      activatable: true,
      activation_target_path: ["windows", "main", "workbenches", "remote-control"],
    });

    const collectionStatus = resolveStudioRuntimeNode(tree, ["windows", "main", "workbenches"]);
    expect(collectionStatus).toMatchObject({
      resource_type: "studio_workbenches",
      id: "workbenches",
      active: false,
      activatable: false,
      activation_target_path: ["windows", "main"],
    });
    expect(collectionStatus?.child_resources).toEqual(
      expect.arrayContaining([
        {
          resource_type: "studio_workbench",
          id: "remote-control",
          label: "Remote Control",
          group: "test",
          path: "/remote-control",
        },
      ])
    );
  });

  it("passes already-active state into activation handlers for idempotent responses", async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-control-"));
    writeStudioDocumentFixture(projectPath);
    const captured: { pathSegments?: string[]; alreadyActive?: boolean } = {};
    const response = {
      statusCode: 0,
      body: "",
      writeHead(statusCode: number) {
        this.statusCode = statusCode;
      },
      end(chunk: string) {
        this.body += chunk;
      },
    };

    await routeStudioControlRequest(
      {
        url: "/v1/studio/windows/main/workbenches/models/activate",
        method: "POST",
        async *[Symbol.asyncIterator]() {
          // No request body is required for activation.
        },
      } as any,
      response as any,
      {
        snapshotProvider: {
          instanceName: "studio-1234",
          pid: 1234,
          mode: "dev",
          workspaceRoot: projectPath,
          getSelectedProjectPath: () => projectPath,
          getActiveWindowScope: () => "main",
          getOpenWindowScopes: () => ["main"],
          getActiveWorkbenchIds: () => ({ main: "models" }),
        },
        selectProject: () => ({
          accepted: false,
          currentProjectPath: projectPath,
          issue: null,
        }),
        activateResource: (pathSegments, alreadyActive) => {
          captured.pathSegments = pathSegments;
          captured.alreadyActive = alreadyActive;
          return {
            accepted: true,
            changed: !alreadyActive,
            activated_path: pathSegments,
            previous_active_path: alreadyActive ? pathSegments : null,
            message: alreadyActive
              ? "Studio resource was already active."
              : "Activated Studio resource.",
          };
        },
      }
    );

    expect(response.statusCode).toBe(200);
    expect(captured).toEqual({
      pathSegments: ["windows", "main", "workbenches", "models"],
      alreadyActive: true,
    });
    expect(JSON.parse(response.body)).toMatchObject({
      accepted: true,
      changed: false,
      activated_path: ["windows", "main", "workbenches", "models"],
      previous_active_path: ["windows", "main", "workbenches", "models"],
    });
  });

  it("decodes encoded resource path segments before resolving status", async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-control-"));
    writeStudioDocumentFixture(projectPath);
    const response = {
      statusCode: 0,
      body: "",
      writeHead(statusCode: number) {
        this.statusCode = statusCode;
      },
      end(chunk: string) {
        this.body += chunk;
      },
    };

    await routeStudioControlRequest(
      {
        url: "/v1/studio/windows/main/workbenches/remote-control/layouts/main%3Aremote-control%3Adefault/status",
        method: "GET",
        async *[Symbol.asyncIterator]() {},
      } as any,
      response as any,
      {
        snapshotProvider: {
          instanceName: "studio-1234",
          pid: 1234,
          mode: "dev",
          workspaceRoot: projectPath,
          getSelectedProjectPath: () => projectPath,
          getActiveWindowScope: () => "main",
          getOpenWindowScopes: () => ["main"],
        },
        selectProject: () => ({
          accepted: false,
          currentProjectPath: projectPath,
          issue: null,
        }),
        activateResource: () => ({
          accepted: false,
          changed: false,
          activated_path: [],
          previous_active_path: null,
          message: "unused",
        }),
      }
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      resource_type: "studio_layout",
      id: "main:remote-control:default",
    });
  });

  it("decodes encoded resource path segments before activating", async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-control-"));
    writeStudioDocumentFixture(projectPath);
    const captured: { pathSegments?: string[] } = {};
    const response = {
      statusCode: 0,
      body: "",
      writeHead(statusCode: number) {
        this.statusCode = statusCode;
      },
      end(chunk: string) {
        this.body += chunk;
      },
    };

    await routeStudioControlRequest(
      {
        url: "/v1/studio/windows/main/workbenches/remote-control/layouts/main%3Aremote-control%3Adefault/activate",
        method: "POST",
        async *[Symbol.asyncIterator]() {},
      } as any,
      response as any,
      {
        snapshotProvider: {
          instanceName: "studio-1234",
          pid: 1234,
          mode: "dev",
          workspaceRoot: projectPath,
          getSelectedProjectPath: () => projectPath,
          getActiveWindowScope: () => "main",
          getOpenWindowScopes: () => ["main"],
        },
        selectProject: () => ({
          accepted: false,
          currentProjectPath: projectPath,
          issue: null,
        }),
        activateResource: (pathSegments) => {
          captured.pathSegments = pathSegments;
          return {
            accepted: true,
            changed: true,
            activated_path: pathSegments,
            previous_active_path: null,
            message: "Activated Studio resource.",
          };
        },
      }
    );

    expect(response.statusCode).toBe(200);
    expect(captured.pathSegments).toEqual([
      "windows",
      "main",
      "workbenches",
      "remote-control",
      "layouts",
      "main:remote-control:default",
    ]);
  });
});
