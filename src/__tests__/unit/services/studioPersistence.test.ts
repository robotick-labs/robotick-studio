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

class MemoryStudioPersistenceStore implements StudioPersistenceStore {
  files = new Map<string, string>();

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

  it("ignores legacy renderer storage when canonical resources are absent", async () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";
    const store = new MemoryStudioPersistenceStore();

    const loaded = await loadStudioPersistence(projectPath, store);

    expect(loaded.source).toBe("empty");
    expect(loaded.model).toEqual({
      windows: [],
      workbenches: [],
      layouts: [],
    });
    expect(store.files.size).toBe(0);
  });
});
