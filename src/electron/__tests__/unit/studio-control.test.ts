import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import type { StudioDocument } from "../../main/studio-persistence";
import {
  buildStudioRuntimeTree,
  resolveStudioRuntimeNode,
} from "../../main/studio-control/studio-context-resolver";
import {
  dispatchStudioControlCommand,
  listStudioControlCommands,
} from "../../main/studio-control/studio-command-registry";
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
    telemetryService?: StudioControlRouteDependencies["telemetryService"];
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
    ...(overrides?.telemetryService ? { telemetryService: overrides.telemetryService } : {}),
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
      project_id: "pip-e",
      project_name: "pip-e",
      project_dir: "/tmp/robots/pip-e",
      project_file_name: "pip-e.project.yaml",
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
      diagnostics_capability_versions: {
        status: 1,
        endpoints: 1,
        renderer: 1,
        console: 1,
        screenshot: 1,
      },
    });
  });

  it("publishes the current live commands through the Electron command registry", () => {
    expect(listStudioControlCommands()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "studio.resource.status",
          provider: "electron_main",
          read_only: true,
          availability: expect.objectContaining({
            resource_scope: "resource",
          }),
        }),
        expect.objectContaining({
          id: "studio.resource.activate",
          provider: "electron_main",
          read_only: false,
          destructive: false,
        }),
        expect.objectContaining({
          id: "studio.project.select",
          provider: "electron_main",
          availability: expect.objectContaining({
            resource_scope: "project",
          }),
        }),
        expect.objectContaining({
          id: "studio.telemetry.models",
          provider: "electron_main",
          read_only: true,
          availability: expect.objectContaining({
            requires_renderer: false,
            resource_scope: "telemetry",
          }),
        }),
        expect.objectContaining({
          id: "studio.telemetry.model.snapshot",
          provider: "electron_main",
          read_only: true,
          availability: expect.objectContaining({
            requires_renderer: false,
            resource_scope: "telemetry",
          }),
        }),
        expect.objectContaining({
          id: "studio.diagnostics.renderer",
          provider: "electron_main",
          availability: expect.objectContaining({
            requires_renderer: true,
            resource_scope: "diagnostics",
          }),
        }),
        expect.objectContaining({
          id: "studio.diagnostics.console",
          provider: "electron_main",
          availability: expect.objectContaining({
            requires_renderer: true,
            resource_scope: "diagnostics",
          }),
        }),
        expect.objectContaining({
          id: "studio.diagnostics.screenshot",
          provider: "electron_main",
          availability: expect.objectContaining({
            requires_renderer: true,
            resource_scope: "diagnostics",
          }),
        }),
      ])
    );
  });

  it("dispatches Studio control commands through the Electron registry", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-command-"));
    const projectPath = path.join(projectDir, "pip-e.project.yaml");
    fs.writeFileSync(projectPath, 'name: "Pip.e"\n', "utf-8");
    writeStudioDocumentFixture(projectDir);

    const dependencies = createControlDependencies(projectPath, {
      snapshotProvider: {
        getFocusedWindowScope: () => "main",
      },
      diagnosticsProvider: {
        getFocusedWindowScope: () => "main",
      },
      activateResource: (pathSegments) => ({
        accepted: true,
        changed: true,
        activated_path: pathSegments,
        previous_active_path: null,
        message: "Activated Studio resource.",
      }),
      selectProject: (nextProjectPath) => ({
        accepted: true,
        currentProjectPath: nextProjectPath,
        issue: null,
      }),
    });

    const statusResult = await dispatchStudioControlCommand(
      "GET",
      "/v1/studio/status",
      dependencies,
      null
    );
    const focusedResult = await dispatchStudioControlCommand(
      "GET",
      "/v1/focused",
      dependencies,
      null
    );
    const activateResult = await dispatchStudioControlCommand(
      "POST",
      "/v1/studio/windows/main/workbenches/models/activate",
      dependencies,
      {}
    );
    const selectProjectResult = await dispatchStudioControlCommand(
      "POST",
      "/v1/project/select",
      dependencies,
      { project_path: projectPath }
    );

    expect(statusResult).toMatchObject({
      statusCode: 200,
      payload: expect.objectContaining({
        resource_type: "studio_instance",
        project_id: "pip-e",
        project_name: "Pip.e",
      }),
    });
    expect(focusedResult).toMatchObject({
      statusCode: 200,
      payload: expect.objectContaining({
        resource_type: "robotick_studio_focused",
        project_id: "pip-e",
        project_display_name: "Pip.e",
      }),
    });
    expect(activateResult).toMatchObject({
      statusCode: 200,
      payload: expect.objectContaining({
        accepted: true,
        activated_path: ["windows", "main", "workbenches", "models"],
      }),
    });
    expect(selectProjectResult).toMatchObject({
      statusCode: 200,
      payload: expect.objectContaining({
        accepted: true,
        currentProjectPath: projectPath,
      }),
    });
  });

  it("dispatches Studio telemetry commands through the Electron registry", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-telemetry-"));
    const projectPath = path.join(projectDir, "barr-e.project.yaml");
    fs.writeFileSync(projectPath, 'name: "Barr.e"\n', "utf-8");
    const modelInfo = {
      model_id: "barr-e-face",
      display_name: "Barr.e Face",
      model_path: "models/barr-e-face.model.yaml",
      engine_model_id: "barr_e_face",
      telemetry_base_url: "http://localhost:9030",
      telemetry_port: 9030,
      telemetry_push_rate_hz: 20,
      health: "ready" as const,
      stale: false,
      latest_frame_seq: 7,
      latest_engine_session_id: "sid",
      latest_raw_at: "2026-06-17T12:00:00.000Z",
      latest_error: null,
    };

    const telemetryService = {
      listModels: vi.fn(async () => ({
        resource_type: "robotick_studio_telemetry_models" as const,
        project_path: projectPath,
        models: [modelInfo],
      })),
      getLayout: vi.fn(async () => ({
        resource_type: "robotick_studio_telemetry_model_layout" as const,
        model: modelInfo,
        layout: { workloads: [], types: [], workloads_buffer_size_used: 0 },
        loaded_at: "2026-06-17T12:00:00.000Z",
      })),
      getSnapshot: vi.fn(async () => ({
        resource_type: "robotick_studio_telemetry_model_snapshot" as const,
        generated_at: "2026-06-17T12:00:00.000Z",
        model: modelInfo,
        source: {
          frame_seq: 7,
          engine_session_id: "sid",
          raw_byte_length: 4,
          layout_loaded_at: "2026-06-17T12:00:00.000Z",
          raw_loaded_at: "2026-06-17T12:00:00.000Z",
        },
        layout: { workloads: [], types: [], workloads_buffer_size_used: 0 },
        engine: null,
        process_threads: [],
        workloads: [],
      })),
      getRawBuffer: vi.fn(async () => ({
        resource_type: "robotick_studio_telemetry_model_raw_buffer" as const,
        model: modelInfo,
        body: Buffer.from([1, 2, 3, 4]),
        byte_length: 4,
        frame_seq: 7,
        engine_session_id: "sid",
        loaded_at: "2026-06-17T12:00:00.000Z",
      })),
      ensureLayoutForBaseUrl: vi.fn(),
      refreshLayoutForBaseUrl: vi.fn(),
      subscribeBaseUrl: vi.fn(() => vi.fn()),
      getBaseUrlDiagnostics: vi.fn(() => ({
        subscriberCount: 0,
        layoutLoaded: false,
        lastFrameAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
      })),
      getHealthForBaseUrl: vi.fn(),
      getPushStatsForBaseUrl: vi.fn(),
      setWorkloadInputFieldsDataForBaseUrl: vi.fn(),
      setWorkloadInputConnectionStateForBaseUrl: vi.fn(),
      reset: vi.fn(),
    } satisfies NonNullable<StudioControlRouteDependencies["telemetryService"]>;

    const dependencies = createControlDependencies(projectPath, { telemetryService });
    const modelsResult = await dispatchStudioControlCommand(
      "GET",
      "/v1/studio/telemetry/models",
      dependencies,
      null
    );
    const layoutResult = await dispatchStudioControlCommand(
      "GET",
      "/v1/studio/telemetry/models/barr-e-face/layout",
      dependencies,
      null
    );
    const snapshotResult = await dispatchStudioControlCommand(
      "GET",
      "/v1/studio/telemetry/models/barr-e-face/snapshot",
      dependencies,
      null
    );
    const rawResult = await dispatchStudioControlCommand(
      "GET",
      "/v1/studio/telemetry/models/barr-e-face/raw-buffer",
      dependencies,
      null
    );

    expect(modelsResult).toMatchObject({
      statusCode: 200,
      payload: { resource_type: "robotick_studio_telemetry_models" },
    });
    expect(layoutResult).toMatchObject({
      statusCode: 200,
      payload: { resource_type: "robotick_studio_telemetry_model_layout" },
    });
    expect(snapshotResult).toMatchObject({
      statusCode: 200,
      payload: { resource_type: "robotick_studio_telemetry_model_snapshot" },
    });
    expect(rawResult).toMatchObject({
      statusCode: 200,
      contentType: "application/octet-stream",
      headers: {
        "X-Robotick-Frame-Seq": "7",
        "X-Robotick-Engine-Session-Id": "sid",
      },
    });
    expect("body" in rawResult! ? Buffer.from(rawResult.body) : null).toEqual(
      Buffer.from([1, 2, 3, 4])
    );
    expect(telemetryService.getSnapshot).toHaveBeenCalledWith("barr-e-face");
  });

  it("routes Studio telemetry raw-buffer responses as bytes", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-telemetry-route-"));
    const projectPath = path.join(projectDir, "barr-e.project.yaml");
    fs.writeFileSync(projectPath, 'name: "Barr.e"\n', "utf-8");
    const modelInfo = {
      model_id: "barr-e-face",
      display_name: "Barr.e Face",
      model_path: "models/barr-e-face.model.yaml",
      engine_model_id: "barr_e_face",
      telemetry_base_url: "http://localhost:9030",
      telemetry_port: 9030,
      telemetry_push_rate_hz: 20,
      health: "ready" as const,
      stale: false,
      latest_frame_seq: 11,
      latest_engine_session_id: "sid-raw",
      latest_raw_at: "2026-06-17T12:00:00.000Z",
      latest_error: null,
    };
    const chunks: Buffer[] = [];
    const response = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      writeHead(statusCode: number, headers: Record<string, string>) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(chunk: Buffer | string) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      },
    };

    await routeStudioControlRequest(
      {
        url: "/v1/studio/telemetry/models/barr-e-face/raw-buffer",
        method: "GET",
        async *[Symbol.asyncIterator]() {},
      } as any,
      response as any,
      createControlDependencies(projectPath, {
        telemetryService: {
          listModels: vi.fn(),
          getLayout: vi.fn(),
          getSnapshot: vi.fn(),
          getRawBuffer: vi.fn(async () => ({
            resource_type: "robotick_studio_telemetry_model_raw_buffer" as const,
            model: modelInfo,
            body: Buffer.from([9, 8, 7]),
            byte_length: 3,
            frame_seq: 11,
            engine_session_id: "sid-raw",
            loaded_at: "2026-06-17T12:00:00.000Z",
          })),
          ensureLayoutForBaseUrl: vi.fn(),
          refreshLayoutForBaseUrl: vi.fn(),
          subscribeBaseUrl: vi.fn(() => vi.fn()),
          getBaseUrlDiagnostics: vi.fn(() => ({
            subscriberCount: 0,
            layoutLoaded: false,
            lastFrameAt: null,
            lastErrorAt: null,
            lastErrorMessage: null,
          })),
          getHealthForBaseUrl: vi.fn(),
          getPushStatsForBaseUrl: vi.fn(),
          setWorkloadInputFieldsDataForBaseUrl: vi.fn(),
          setWorkloadInputConnectionStateForBaseUrl: vi.fn(),
          reset: vi.fn(),
        } satisfies NonNullable<StudioControlRouteDependencies["telemetryService"]>,
      })
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "Content-Type": "application/octet-stream",
      "Content-Length": "3",
      "X-Robotick-Frame-Seq": "11",
      "X-Robotick-Engine-Session-Id": "sid-raw",
    });
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([9, 8, 7]));
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

  it("returns console diagnostics from the Studio-owned bounded log buffer", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-console-"));
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
        url: "/v1/studio/diagnostics/console",
        method: "GET",
        async *[Symbol.asyncIterator]() {},
      } as any,
      response as any,
      createControlDependencies(workspaceRoot, {
        diagnosticsProvider: {
          getActiveWindowScope: () => "main",
          getConsoleRecords: () => [
            {
              window_id: "main",
              recorded_at: "2026-06-12T21:00:04.000Z",
              level: "error",
              message: "Failed to fetch",
              source_url: "http://localhost:5173/assets/index.js",
              line: 12,
              column: 7,
              stack: "Error: Failed to fetch",
              payload: { source: "renderer_console" },
            },
          ],
        },
      })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      resource_type: "studio_diagnostics_console",
      instance_id: "studio-1234",
      active_window_id: "main",
      records: [
        {
          window_id: "main",
          level: "error",
          message: "Failed to fetch",
          source_url: "http://localhost:5173/assets/index.js",
        },
      ],
      truncation: {
        truncated: false,
        original_count: 1,
        returned_count: 1,
        limit: 500,
      },
    });
  });

  it("captures screenshot diagnostics into the workspace diagnostics directory", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-screenshot-"));
    const activateResource = vi.fn(() => ({
      accepted: true,
      changed: true,
      activated_path: ["windows", "main", "workbenches", "remote-control"],
      previous_active_path: null,
      message: "activated",
    }));
    const imageBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x01, 0x40, 0x00, 0x00, 0x00, 0xf0,
    ]);
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
        url: "/v1/studio/diagnostics/screenshot?resource_path=windows/main/workbenches/remote-control&wait_ms=1&expected_resource=remote-control",
        method: "GET",
        async *[Symbol.asyncIterator]() {},
      } as any,
      response as any,
      createControlDependencies(workspaceRoot, {
        diagnosticsProvider: {
          workspaceRoot,
          getActiveWindowScope: () => "main",
          getOpenWindowScopes: () => ["main"],
          getWindowUrl: () => "http://localhost:5173/remote-control",
          getActiveWorkbenchIds: () => ({ main: "remote-control" }),
          getActiveLayoutIds: () => ({ main: "main:remote-control:default" }),
          getActivePanelIds: () => ({ main: "panel-remote-control" }),
          captureScreenshot: async () => imageBytes,
        },
        activateResource,
      })
    );

    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      resource_type: "studio_diagnostics_screenshot",
      instance_id: "studio-1234",
      window_id: "main",
      mime_type: "image/png",
      dimensions: { width: 320, height: 240 },
      active_window_url: "http://localhost:5173/remote-control",
      active_workbench_id: "remote-control",
      active_layout_id: "main:remote-control:default",
      active_panel_id: null,
      capture_source: "electron_capture_page",
      validation: {
        nonblank_pixel_check: true,
        dominant_content_area: { x: 0, y: 0, width: 320, height: 240 },
        expected_resource_match: true,
      },
    });
    expect(body.output_path).toContain(path.join(workspaceRoot, ".robotick", "diagnostics"));
    expect(fs.readFileSync(body.output_path)).toEqual(imageBytes);
    expect(activateResource).toHaveBeenCalledWith(
      ["windows", "main", "workbenches", "remote-control"],
      false
    );
  });

  it("returns DOM and CSS diagnostics from renderer inspection commands", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-dom-"));
    const request = async (url: string) => {
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
          url,
          method: "GET",
          async *[Symbol.asyncIterator]() {},
        } as any,
        response as any,
        createControlDependencies(workspaceRoot, {
          diagnosticsProvider: {
            getActiveWindowScope: () => "main",
            getOpenWindowScopes: () => ["main"],
            executeRendererDiagnosticsScript: async (_windowId, script) => {
              if (script.includes("studio_diagnostics_dom_summary")) {
                return {
                  resource_type: "studio_diagnostics_dom_summary",
                  window_id: "main",
                  url: "http://localhost:5173/remote-control",
                  document_title: "Robotick Studio",
                  active_route: "/remote-control",
                  visible_workbench_root: "main Remote Control",
                  focused_element_summary: "button Launch",
                  selected_project_text: "Barr.e",
                  redactions: [],
                  truncation: {
                    truncated: false,
                    original_count: 10,
                    returned_count: 10,
                    limit: 50,
                  },
                };
              }
              if (script.includes("studio_diagnostics_dom_query")) {
                return {
                  resource_type: "studio_diagnostics_dom_query",
                  window_id: "main",
                  selector: "[data-project-picker]",
                  match_count: 1,
                  matches: [
                    {
                      text: "Barr.e",
                      attributes: { "data-testid": "project-picker" },
                      rect: { x: 1, y: 2, width: 3, height: 4 },
                      visible: true,
                      disabled: false,
                      aria_label: "Project",
                      aria_name: "Project",
                      selected_value: "[redacted]",
                    },
                  ],
                  redactions: [
                    {
                      path: "matches[0].selected_value",
                      reason: "input_value",
                      replacement: "[redacted]",
                    },
                  ],
                  truncation: {
                    truncated: false,
                    original_count: 1,
                    returned_count: 1,
                    limit: 20,
                  },
                };
              }
              return {
                resource_type: "studio_diagnostics_css_query",
                window_id: "main",
                selector: "[data-project-picker]",
                match_count: 1,
                matches: [
                  {
                    computed_styles: { display: "flex", visibility: "visible" },
                    layout: {
                      x: 1,
                      y: 2,
                      width: 3,
                      height: 4,
                      overflow_x: "visible",
                      overflow_y: "visible",
                    },
                  },
                ],
                loaded_stylesheet_urls: ["http://localhost:5173/assets/index.css"],
                failed_stylesheet_urls: [],
                truncation: {
                  truncated: false,
                  original_count: 1,
                  returned_count: 1,
                  limit: 20,
                },
              };
            },
          },
        })
      );
      return { statusCode: response.statusCode, body: JSON.parse(response.body) };
    };

    await expect(request("/v1/studio/diagnostics/dom/summary")).resolves.toMatchObject({
      statusCode: 200,
      body: {
        resource_type: "studio_diagnostics_dom_summary",
        instance_id: "studio-1234",
        selected_project_text: "Barr.e",
      },
    });
    await expect(
      request("/v1/studio/diagnostics/dom/query?selector=%5Bdata-project-picker%5D")
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        resource_type: "studio_diagnostics_dom_query",
        selector: "[data-project-picker]",
        redactions: [{ reason: "input_value" }],
      },
    });
    await expect(
      request("/v1/studio/diagnostics/css/query?selector=%5Bdata-project-picker%5D&properties=display,visibility")
    ).resolves.toMatchObject({
      statusCode: 200,
      body: {
        resource_type: "studio_diagnostics_css_query",
        selector: "[data-project-picker]",
        loaded_stylesheet_urls: ["http://localhost:5173/assets/index.css"],
      },
    });
  });

  it("returns diagnostics unavailable when screenshot capture has no live image", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-screenshot-"));
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
        url: "/v1/studio/diagnostics/screenshot",
        method: "GET",
        async *[Symbol.asyncIterator]() {},
      } as any,
      response as any,
      createControlDependencies(workspaceRoot, {
        diagnosticsProvider: {
          getActiveWindowScope: () => "main",
          getOpenWindowScopes: () => ["main"],
          captureScreenshot: async () => null,
        },
      })
    );

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ error: "diagnostics_unavailable" });
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
          fetchDiagnosticUrl: async (target) => ({
            target_id: target.target_id,
            effective_url: target.url,
            method: target.method,
            origin: target.origin,
            ok: target.target_id !== "project-settings",
            status_code: target.target_id === "project-settings" ? 503 : 200,
            response_headers: {},
            error_name: null,
            error_message:
              target.target_id === "project-settings"
                ? "Request failed 503"
                : null,
            failure_classification:
              target.target_id === "project-settings" ? "non_ok_http" : null,
          }),
          getRendererDiagnostics: () => ({
            updated_at: "2026-06-12T21:00:02.000Z",
            launcher: {
              current_project_path: "/tmp/barr-e.project.yaml",
              launcher_profile: "native",
              static_hub_endpoint: "http://127.0.0.1:7000",
              cached_hub_endpoint: "http://127.0.0.1:7000",
              launcher_api_base: "http://127.0.0.1:7001",
              terminal_log_stream_url:
                "ws://127.0.0.1:7001/v1/launcher/models/logs/stream",
              bootstrap_issue: null,
              last_runtime_fetch_at: null,
              last_runtime_fetch_error: null,
            },
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
      checks: expect.arrayContaining([
        expect.objectContaining({ target_id: "hub-project-list", ok: true }),
        expect.objectContaining({ target_id: "launcher-runtime", ok: true }),
        expect.objectContaining({ target_id: "terminal-log-snapshot", ok: true }),
        expect.objectContaining({
          target_id: "project-settings",
          failure_classification: "non_ok_http",
        }),
        expect.objectContaining({
          target_id: "terminal-log-websocket",
          failure_classification: "websocket_upgrade_failure",
        }),
      ]),
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
          fetchDiagnosticUrl: async (target) => ({
            target_id: target.target_id,
            effective_url: target.url,
            method: target.method,
            origin: target.origin,
            ok: true,
            status_code: 200,
            response_headers: {},
            error_name: null,
            error_message: null,
            failure_classification: null,
          }),
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
      model_health: [
        expect.objectContaining({
          model_id: "barr-e-face",
          hub_health_ok: true,
          renderer_health_ok: true,
          websocket_ok: true,
        }),
      ],
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

  it("returns aggregate diagnostics snapshots", async () => {
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
        url: "/v1/studio/diagnostics/snapshot",
        method: "GET",
        async *[Symbol.asyncIterator]() {},
      } as any,
      response as any,
      createControlDependencies(workspaceRoot, {
        diagnosticsProvider: {
          getOpenWindowScopes: () => ["main"],
          getActiveWindowScope: () => "main",
          fetchDiagnosticUrl: async (target) => ({
            target_id: target.target_id,
            effective_url: target.url,
            method: target.method,
            origin: target.origin,
            ok: true,
            status_code: 200,
            response_headers: {},
            error_name: null,
            error_message: null,
            failure_classification: null,
          }),
          executeRendererDiagnosticsScript: async () => ({
            resource_type: "studio_diagnostics_dom_summary",
            window_id: "main",
            url: "http://localhost:5173/remote-control",
            document_title: "Robotick Studio",
            active_route: "/remote-control",
            visible_workbench_root: "main Remote Control",
            focused_element_summary: null,
            selected_project_text: "Barr.e",
            redactions: [],
            truncation: {
              truncated: false,
              original_count: 1,
              returned_count: 1,
              limit: 50,
            },
          }),
        },
      })
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      resource_type: "studio_diagnostics_snapshot",
      instance_id: "studio-1234",
      status: { resource_type: "studio_diagnostics_status" },
      endpoints: { resource_type: "studio_diagnostics_endpoints" },
      renderer: { resource_type: "studio_diagnostics_renderer" },
      fetch_check: { resource_type: "studio_diagnostics_fetch_check" },
      telemetry: { resource_type: "studio_diagnostics_telemetry" },
      dom_summary: { resource_type: "studio_diagnostics_dom_summary" },
    });
  });
});
