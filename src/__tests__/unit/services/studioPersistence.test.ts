import { describe, expect, it } from "vitest";
import {
  STUDIO_PERSISTENCE_SCHEMA_VERSION,
  getStudioLayoutResourcePath,
  getStudioLayoutResourceRelativePath,
  getStudioProjectDirectory,
  getStudioResourcePaths,
  getStudioRootPath,
  getStudioWindowResourcePath,
  getStudioWindowResourceRelativePath,
  getStudioWorkbenchResourcePath,
  getStudioWorkbenchResourceRelativePath,
  loadStudioResourceFiles,
  loadStudioPersistence,
  writeStudioResourceFiles,
  type StudioPersistenceModel,
  type StudioPersistenceStore,
  type StudioResourceDirectory,
} from "../../../renderer/services/studio-persistence";
import { areStudioPersistenceModelsMigrationEquivalent } from "../../../renderer/services/studio-persistence/scaffolding/migration-equivalence";

class MemoryStudioPersistenceStore implements StudioPersistenceStore {
  files = new Map<string, string>();

  constructor(private legacyStorage: Record<string, string> | null = null) {}

  async listResourceFiles(
    _projectPath: string,
    directory: StudioResourceDirectory
  ): Promise<string[]> {
    const prefix = `studio/${directory}/`;
    return Array.from(this.files.keys())
      .filter((key) => key.startsWith(prefix))
      .sort();
  }

  async readResourceFile(
    _projectPath: string,
    resourcePath: string
  ): Promise<string | null> {
    return this.files.get(resourcePath) ?? null;
  }

  async writeResourceFile(
    _projectPath: string,
    resourcePath: string,
    content: string
  ): Promise<void> {
    this.files.set(resourcePath, content);
  }

  async readLegacyRendererStorage(): Promise<Record<string, string> | null> {
    return this.legacyStorage;
  }
}

const canonicalModel: StudioPersistenceModel = {
  windows: [
    {
      resourceType: "studio_window",
      schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
      id: "main",
      slug: "main",
      label: "Main Window",
      windowRole: "main",
      hostedWorkbenchIds: ["remote-control"],
      defaultWorkbenchId: "remote-control",
    },
  ],
  workbenches: [
    {
      resourceType: "studio_workbench",
      schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
      id: "remote-control",
      slug: "remote-control",
      label: "Remote Control",
      source: "project",
      layoutIds: ["main:remote-control:default"],
      defaultLayoutId: "main:remote-control:default",
      windowIds: ["main"],
    },
  ],
  layouts: [
    {
      resourceType: "studio_layout",
      schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
      id: "main:remote-control:default",
      slug: "main.remote-control.default",
      label: "Default",
      workbenchId: "remote-control",
      dockTree: {
        nodeType: "panel",
        panelInstanceId: "panel-main",
      },
      panelInstances: [
        {
          panelInstanceId: "panel-main",
          editorId: "terminal",
          settings: { filter: "warning" },
        },
      ],
    },
  ],
};

describe("studioPersistence", () => {
  it("resolves project-relative studio paths for POSIX project files", () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";

    expect(getStudioProjectDirectory(projectPath)).toBe("/repo/robots/barr-e");
    expect(getStudioRootPath(projectPath)).toBe("/repo/robots/barr-e/studio");
    expect(getStudioWorkbenchResourcePath(projectPath, "remote-control")).toBe(
      "/repo/robots/barr-e/studio/workbenches/remote-control.workbench.json"
    );
    expect(getStudioLayoutResourcePath(projectPath, "remote-control.default")).toBe(
      "/repo/robots/barr-e/studio/layouts/remote-control.default.layout.json"
    );
    expect(getStudioWindowResourcePath(projectPath, "main")).toBe(
      "/repo/robots/barr-e/studio/windows/main.window.json"
    );
  });

  it("resolves project-relative studio paths for Windows project files", () => {
    const projectPath = "C:\\repo\\robots\\barr-e\\barr-e.project.yaml";

    expect(getStudioProjectDirectory(projectPath)).toBe("C:\\repo\\robots\\barr-e");
    expect(getStudioRootPath(projectPath)).toBe("C:\\repo\\robots\\barr-e\\studio");
    expect(getStudioWorkbenchResourcePath(projectPath, "remote-control")).toBe(
      "C:\\repo\\robots\\barr-e\\studio\\workbenches\\remote-control.workbench.json"
    );
    expect(getStudioLayoutResourcePath(projectPath, "remote-control.default")).toBe(
      "C:\\repo\\robots\\barr-e\\studio\\layouts\\remote-control.default.layout.json"
    );
    expect(getStudioWindowResourcePath(projectPath, "main")).toBe(
      "C:\\repo\\robots\\barr-e\\studio\\windows\\main.window.json"
    );
  });

  it("exposes the shared studio directory bundle and schema version", () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";

    expect(STUDIO_PERSISTENCE_SCHEMA_VERSION).toBe(1);
    expect(getStudioResourcePaths(projectPath)).toEqual({
      projectDirectory: "/repo/robots/barr-e",
      studioRoot: "/repo/robots/barr-e/studio",
      windowsDirectory: "/repo/robots/barr-e/studio/windows",
      workbenchesDirectory: "/repo/robots/barr-e/studio/workbenches",
      layoutsDirectory: "/repo/robots/barr-e/studio/layouts",
    });
  });

  it("round-trips canonical resources through the project store", async () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";
    const store = new MemoryStudioPersistenceStore();

    await writeStudioResourceFiles(projectPath, store, canonicalModel);

    expect(store.files.has(getStudioWindowResourceRelativePath("main"))).toBe(true);
    expect(
      store.files.has(getStudioWorkbenchResourceRelativePath("remote-control"))
    ).toBe(true);
    expect(
      store.files.has(getStudioLayoutResourceRelativePath("main.remote-control.default"))
    ).toBe(true);

    await expect(loadStudioResourceFiles(projectPath, store)).resolves.toEqual(
      canonicalModel
    );
  });

  it("migrates legacy renderer storage and then loads equivalent canonical resources", async () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";
    const store = new MemoryStudioPersistenceStore({
      "workspace-layout-tabs:main:remote-control": JSON.stringify({
        tabs: [
          { id: "default", name: "Default" },
          { id: "debug", name: "Debug" },
        ],
        activeTabId: "debug",
      }),
      "panelLayout:main:remote-control:default": JSON.stringify({
        kind: "split",
        id: "split-a",
        direction: "horizontal",
        ratio: 0.42,
        children: [
          { kind: "leaf", id: "panel-left", editorId: "terminal" },
          { kind: "leaf", id: "panel-right", editorId: "models" },
        ],
      }),
      "floating-panels:main:remote-control:default": JSON.stringify([
        {
          id: "floating-terminal",
          editorId: "terminal",
          title: "Logs",
          settings: { filter: "error" },
          minSize: { width: 260, height: 180 },
        },
      ]),
      "generic-panel:floating-panel:main:remote-control:default:floating-terminal":
        JSON.stringify({
          position: { x: 24, y: 32 },
          size: { width: 720, height: 360 },
        }),
      "robotick-studio.terminal.panel.remote-control.panel-left": JSON.stringify({
        filter: "warning",
        wrapText: false,
        autoScroll: true,
      }),
      "robotick-studio.terminal.panel.main:remote-control:default.floating-terminal":
        JSON.stringify({
          filter: "error",
          wrapText: true,
          autoScroll: false,
        }),
      "robotick-studio.models.sort.remote-control.panel-right./repo/robots/barr-e/barr-e.project.yaml":
        "model_name",
      "studio.child-window-presets.v1": JSON.stringify([
        {
          id: "preset-a",
          name: "Telemetry Window",
          seedUrl: "http://localhost/workspaces/telemetry",
          scope: "child-preset-a",
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
        },
      ]),
    });

    const migrated = await loadStudioPersistence(projectPath, store);

    expect(migrated.source).toBe("legacy");
    expect(migrated.model.windows.map((window) => window.id).sort()).toEqual([
      "child-preset-a",
      "main",
    ]);
    expect(migrated.model.workbenches).toHaveLength(1);
    expect(migrated.model.layouts).toHaveLength(2);
    expect(
      migrated.model.layouts.find(
        (layout) => layout.id === "main:remote-control:default"
      )?.floatingPanels?.[0].frame
    ).toEqual({
      x: 24,
      y: 32,
      width: 720,
      height: 360,
      minWidth: 260,
      minHeight: 180,
    });
    expect(
      migrated.model.layouts
        .find((layout) => layout.id === "main:remote-control:default")
        ?.panelInstances.find((panel) => panel.panelInstanceId === "panel-left")
        ?.settings
    ).toMatchObject({
      terminal: { filter: "warning", wrapText: false, autoScroll: true },
    });
    expect(
      migrated.model.layouts
        .find((layout) => layout.id === "main:remote-control:default")
        ?.panelInstances.find((panel) => panel.panelInstanceId === "panel-right")
        ?.settings
    ).toMatchObject({
      models: { sort: "model_name" },
    });
    expect(
      migrated.model.layouts.find(
        (layout) => layout.id === "main:remote-control:default"
      )?.floatingPanels?.[0].settings
    ).toMatchObject({
      filter: "error",
      terminal: { filter: "error", wrapText: true, autoScroll: false },
    });

    const canonical = await loadStudioPersistence(projectPath, store);

    expect(canonical.source).toBe("canonical");
    expect(
      areStudioPersistenceModelsMigrationEquivalent(migrated.model, canonical.model)
    ).toBe(true);
  });
});
