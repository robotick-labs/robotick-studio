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
import type { StudioControlRouteDependencies } from "../../main/studio-control/studio-control-routes";

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

function createControlDependencies(
  projectPath: string,
  overrides?: {
    snapshotProvider?: Partial<StudioControlRouteDependencies["snapshotProvider"]>;
    diagnosticsProvider?: Partial<StudioControlRouteDependencies["diagnosticsProvider"]>;
    selectProject?: StudioControlRouteDependencies["selectProject"];
    activateResource?: StudioControlRouteDependencies["activateResource"];
  },
): StudioControlRouteDependencies {
  return {
    snapshotProvider: {
      instanceName: "studio-1234",
      pid: 1234,
      mode: "dev",
      workspaceRoot: projectPath,
      getSelectedProjectPath: () => projectPath,
      getActiveWindowScope: () => "main",
      getOpenWindowScopes: () => ["main"],
      ...(overrides?.snapshotProvider ?? {}),
    },
    diagnosticsProvider: {
      instanceName: "studio-1234",
      pid: 1234,
      mode: "dev",
      workspaceRoot: projectPath,
      startupHubEndpoint: "http://127.0.0.1:7000",
      getCurrentHubEndpoint: () => "http://127.0.0.1:7000",
      getSelectedProjectPath: () => projectPath,
      getActiveWindowScope: () => "main",
      getOpenWindowScopes: () => ["main"],
      getWindowUrl: () => "http://localhost:5173/remote-control",
      fetchHubHealth: async () => null,
      ...(overrides?.diagnosticsProvider ?? {}),
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
    ...(overrides?.selectProject ? { selectProject: overrides.selectProject } : {}),
    ...(overrides?.activateResource ? { activateResource: overrides.activateResource } : {}),
  };
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
      resource_uri: "studio://studio-1234",
      active_window_id: "main",
      state_sources: { active_window_id: "runtime" },
      active: false,
      activatable: false,
      activation_target_path: null,
      actions: [
        expect.objectContaining({
          id: "studio.resource.status",
          path: ["status"],
          resource_uri: "studio://studio-1234",
        }),
      ],
      child_collections: [
        { name: "windows", resource_type: "studio_windows", item_count: 1 },
      ],
    });
    expect(status?.children?.windows?.[0]).toMatchObject({
      resource_type: "studio_window",
      id: "main",
      label: "Main Window",
      resource_uri: "studio://studio-1234/windows/main",
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
      resource_uri: "studio://studio-1234/windows/main/workbenches/remote-control",
      active: true,
      activatable: true,
      activation_target_path: ["windows", "main", "workbenches", "remote-control"],
      actions: expect.arrayContaining([
        expect.objectContaining({
          id: "studio.resource.activate",
          path: ["windows", "main", "workbenches", "remote-control", "activate"],
        }),
      ]),
    });

    const collectionStatus = resolveStudioRuntimeNode(tree, ["windows", "main", "workbenches"]);
    expect(collectionStatus).toMatchObject({
      resource_type: "studio_workbenches",
      id: "workbenches",
      resource_uri: "studio://studio-1234/windows/main/workbenches",
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
          resource_uri: "studio://studio-1234/windows/main/workbenches/remote-control",
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
      createControlDependencies(projectPath, {
        snapshotProvider: {
          getActiveWorkbenchIds: () => ({ main: "models" }),
        },
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
      })
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
      createControlDependencies(projectPath)
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
      createControlDependencies(projectPath, {
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
      })
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

  it("returns diagnostics status with live project identity and focus metadata", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-diagnostics-"));
    const projectPath = path.join(projectDir, "pip-e.project.yaml");
    fs.writeFileSync(projectPath, 'name: "Pip.e"\n', "utf-8");
    writeStudioDocumentFixture(projectDir);
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
        url: "/v1/diagnostics/status",
        method: "GET",
        async *[Symbol.asyncIterator]() {},
      } as any,
      response as any,
      createControlDependencies(projectPath, {
        snapshotProvider: {
          getFocusedWindowScope: () => "main",
          getLastFocusedAt: () => "2026-06-12T21:00:01.000Z",
          getActiveWorkbenchIds: () => ({ main: "remote-control" }),
          getActiveLayoutIds: () => ({ "main/remote-control": "main:remote-control:default" }),
        },
        diagnosticsProvider: {
          startedAt: "2026-06-12T21:00:00.000Z",
          getFocusedWindowScope: () => "main",
          getLastFocusedAt: () => "2026-06-12T21:00:01.000Z",
          getActiveWorkbenchIds: () => ({ main: "remote-control" }),
          getActiveLayoutIds: () => ({ "main/remote-control": "main:remote-control:default" }),
        },
      })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      resource_type: "studio_diagnostics_status",
      instance_id: "studio-1234",
      selected_project_id: "pip-e",
      selected_project_path: projectPath,
      project_directory: projectDir,
      project_file_name: "pip-e.project.yaml",
      project_display_name: "Pip.e",
      ui_project_label: "Pip.e",
      active_window_id: "main",
      focused_window_id: "main",
      active_workbench_id: "remote-control",
      active_layout_id: "main:remote-control:default",
      diagnostics_capability_versions: { status: 1, endpoints: 1, renderer: 1 },
    });
  });

  it("returns diagnostics endpoints with stale hub warnings and hub health", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-diagnostics-"));
    fs.mkdirSync(path.join(workspaceRoot, ".robotick"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, ".robotick", "hub.json"),
      JSON.stringify({ endpoint: "http://127.0.0.1:7002", pid: 4321 }),
      "utf-8"
    );
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
        url: "/v1/studio/diagnostics/endpoints",
        method: "GET",
        async *[Symbol.asyncIterator]() {},
      } as any,
      response as any,
      createControlDependencies(workspaceRoot, {
        snapshotProvider: {
          getSelectedProjectPath: () => "",
        },
        diagnosticsProvider: {
          workspaceRoot,
          startupHubEndpoint: "http://127.0.0.1:7000",
          getCurrentHubEndpoint: () => "http://127.0.0.1:7001",
          getSelectedProjectPath: () => "",
          fetchHubHealth: async (endpoint) => ({
            endpoint,
            status: "ok",
            api_version: 1,
            features: ["studio_instances", "studio_status"],
            tray_expected: false,
            tray_active: true,
          }),
        },
      })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      resource_type: "studio_diagnostics_endpoints",
      startup_hub_endpoint: "http://127.0.0.1:7000",
      current_hub_endpoint: "http://127.0.0.1:7001",
      workspace_hub_record: {
        endpoint: "http://127.0.0.1:7002",
        pid: 4321,
      },
      hub_health: {
        endpoint: "http://127.0.0.1:7001",
        status: "ok",
        api_version: 1,
      },
      renderer_origin: "http://localhost:5173",
      active_window_url: "http://localhost:5173/remote-control",
      stale_endpoint_warnings: [
        {
          code: "stale_hub_endpoint",
        },
      ],
    });
  });

  it("returns renderer diagnostics with published snapshot and bounded errors", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-diagnostics-"));
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
        url: "/v1/studio/diagnostics/renderer",
        method: "GET",
        async *[Symbol.asyncIterator]() {},
      } as any,
      response as any,
      createControlDependencies(workspaceRoot, {
        snapshotProvider: {
          getSelectedProjectPath: () => "",
        },
        diagnosticsProvider: {
          workspaceRoot,
          getSelectedProjectPath: () => "",
          getOpenWindowScopes: () => ["main", "child-window-1"],
          getActiveWindowScope: () => "main",
          getWindowUrl: (scope) =>
            scope === "main"
              ? "http://localhost:5173/"
              : "http://localhost:5173/#/anim",
          getRendererDiagnostics: (windowId) =>
            windowId === "main"
              ? {
                  updated_at: "2026-06-12T21:00:02.000Z",
                  launcher: {
                    current_project_path: "/tmp/pip-e.project.yaml",
                    launcher_profile: "native:ALL",
                    static_hub_endpoint: "http://127.0.0.1:7000",
                    cached_hub_endpoint: "http://127.0.0.1:7001",
                    launcher_api_base: "http://127.0.0.1:7001",
                    terminal_log_stream_url: "ws://127.0.0.1:7001/v1/launcher/models/logs/stream",
                    bootstrap_issue: null,
                    last_runtime_fetch_at: "2026-06-12T21:00:01.000Z",
                    last_runtime_fetch_error: null,
                  },
                }
              : null,
          getRendererErrors: (windowId) =>
            windowId === "main"
              ? [
                  {
                    window_id: "main",
                    recorded_at: "2026-06-12T21:00:03.000Z",
                    type: "error",
                    message: "Failed to fetch",
                    source: "http://localhost:5173/assets/index.js",
                    lineno: 12,
                    colno: 7,
                    stack: "Error: Failed to fetch",
                  },
                ]
              : [],
        },
      })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      resource_type: "studio_diagnostics_renderer",
      active_window_id: "main",
      windows: [
        {
          window_id: "main",
          url: "http://localhost:5173/",
          snapshot: {
            updated_at: "2026-06-12T21:00:02.000Z",
            launcher: {
              launcher_api_base: "http://127.0.0.1:7001",
            },
          },
          recent_errors: [
            {
              message: "Failed to fetch",
            },
          ],
        },
        {
          window_id: "child-window-1",
          url: "http://localhost:5173/#/anim",
          snapshot: null,
          recent_errors: [],
        },
      ],
    });
  });

  it("returns fetch-check diagnostics aggregated from renderer snapshots", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-diagnostics-"));
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
        url: "/v1/studio/diagnostics/fetch-check",
        method: "GET",
        async *[Symbol.asyncIterator]() {},
      } as any,
      response as any,
      createControlDependencies(workspaceRoot, {
        diagnosticsProvider: {
          getOpenWindowScopes: () => ["main"],
          getActiveWindowScope: () => "main",
          getRendererDiagnostics: () => ({
            updated_at: "2026-06-12T21:00:02.000Z",
            fetch_failures: [
              {
                recorded_at: "2026-06-12T21:00:01.000Z",
                source: "launcher-interface",
                operation: "GET /v1/launcher/runtime",
                url: "http://127.0.0.1:7001/v1/launcher/runtime",
                status_code: 503,
                message: "Request failed 503",
              },
            ],
            websocket_failures: [
              {
                recorded_at: "2026-06-12T21:00:03.000Z",
                source: "terminal-log-service",
                phase: "close",
                url: "ws://127.0.0.1:7001/v1/launcher/models/logs/stream",
                close_code: 1006,
                message: "terminal log websocket closed",
              },
            ],
          }),
        },
      })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      resource_type: "studio_diagnostics_fetch_check",
      active_window_id: "main",
      fetch_failures: [expect.objectContaining({ source: "launcher-interface" })],
      websocket_failures: [expect.objectContaining({ source: "terminal-log-service" })],
    });
  });

  it("returns telemetry diagnostics from renderer snapshots", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-diagnostics-"));
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
        url: "/v1/studio/diagnostics/telemetry",
        method: "GET",
        async *[Symbol.asyncIterator]() {},
      } as any,
      response as any,
      createControlDependencies(workspaceRoot, {
        diagnosticsProvider: {
          getOpenWindowScopes: () => ["main"],
          getActiveWindowScope: () => "main",
          getRendererDiagnostics: () => ({
            updated_at: "2026-06-12T21:00:02.000Z",
            telemetry: {
              loading: false,
              error: null,
              model_count: 1,
              models: [
                {
                  model_id: "barr-e-face",
                  telemetry_base_url: "http://127.0.0.1:7091",
                  subscriber_count: 2,
                  last_frame_at: "2026-06-12T21:00:01.000Z",
                  ingress_rate_hz: 20,
                  layout_loaded: true,
                  has_latest_model: true,
                  last_error: null,
                },
              ],
            },
          }),
        },
      })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      resource_type: "studio_diagnostics_telemetry",
      active_window_id: "main",
      windows: [
        {
          window_id: "main",
          telemetry: {
            model_count: 1,
            models: [expect.objectContaining({ model_id: "barr-e-face" })],
          },
        },
      ],
    });
  });
});
