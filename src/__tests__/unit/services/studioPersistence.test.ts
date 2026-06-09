import { describe, expect, it } from "vitest";
import {
  STUDIO_PERSISTENCE_SCHEMA_VERSION,
  createEmptyStudioPersistenceModel,
  getStudioDocumentPath,
  getStudioDocumentRelativePath,
  getStudioProjectDirectory,
  getStudioResourcePaths,
  getStudioRootPath,
  loadStudioDocument,
  loadStudioPersistence,
  writeStudioDocument,
  type StudioPersistenceModel,
  type StudioPersistenceStore,
} from "../../../renderer/services/studio-persistence";

class MemoryStudioPersistenceStore implements StudioPersistenceStore {
  files = new Map<string, string>();

  async readStudioDocument(_projectPath: string): Promise<string | null> {
    return this.files.get(getStudioDocumentRelativePath()) ?? null;
  }

  async ensureStudioDocument(_projectPath: string): Promise<void> {
    return;
  }

  async writeStudioDocument(
    _projectPath: string,
    content: string
  ): Promise<void> {
    this.files.set(getStudioDocumentRelativePath(), content);
  }
}

const canonicalModel: StudioPersistenceModel = {
  resourceType: "studio_document",
  schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
  id: "barr-e-studio",
  windows: [
    {
      id: "main",
      label: "Main Window",
      windowRole: "main",
      defaultWorkbenchId: "remote-control",
      workbenches: [
        {
          id: "remote-control",
          path: "/remote-control",
          label: "Remote Control",
          defaultLayoutId: "main:remote-control:default",
          layouts: [
            {
              id: "main:remote-control:default",
              label: "Default",
              dock: {
                nodeType: "panel",
                panelId: "panel-main",
                editorId: "terminal",
                settings: { filter: "warning" },
              },
            },
          ],
        },
      ],
    },
  ],
};

const defaultCanonicalModel: StudioPersistenceModel = {
  resourceType: "studio_document",
  schemaVersion: STUDIO_PERSISTENCE_SCHEMA_VERSION,
  id: "barr-e-studio",
  windows: [
    {
      id: "main",
      label: "Main Window",
      windowRole: "main",
      defaultWorkbenchId: "remote-control",
      workbenches: [
        {
          id: "remote-control",
          path: "/remote-control",
          label: "Remote Control",
          defaultEditorId: "terminal",
          defaultLayoutId: "main:remote-control:default",
          layouts: [
            {
              id: "main:remote-control:default",
              label: "Remote Control | Default",
              dock: {
                nodeType: "panel",
                panelId: "panel-remote-control",
                editorId: "terminal",
              },
            },
          ],
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
    expect(getStudioDocumentPath(projectPath)).toBe(
      "/repo/robots/barr-e/studio/studio.yaml"
    );
  });

  it("resolves project-relative studio paths for Windows project files", () => {
    const projectPath = "C:\\repo\\robots\\barr-e\\barr-e.project.yaml";

    expect(getStudioProjectDirectory(projectPath)).toBe("C:\\repo\\robots\\barr-e");
    expect(getStudioRootPath(projectPath)).toBe("C:\\repo\\robots\\barr-e\\studio");
    expect(getStudioDocumentPath(projectPath)).toBe(
      "C:\\repo\\robots\\barr-e\\studio\\studio.yaml"
    );
  });

  it("exposes the shared studio document path and schema version", () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";

    expect(STUDIO_PERSISTENCE_SCHEMA_VERSION).toBe(1);
    expect(getStudioResourcePaths(projectPath)).toEqual({
      projectDirectory: "/repo/robots/barr-e",
      studioRoot: "/repo/robots/barr-e/studio",
      studioDocument: "/repo/robots/barr-e/studio/studio.yaml",
    });
  });

  it("round-trips the canonical studio document through the project store", async () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";
    const store = new MemoryStudioPersistenceStore();

    await writeStudioDocument(projectPath, store, canonicalModel);

    expect(store.files.has(getStudioDocumentRelativePath())).toBe(true);
    await expect(loadStudioDocument(projectPath, store)).resolves.toEqual(
      canonicalModel
    );
  });

  it("materializes a yaml document on first write when no document exists", async () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";
    const store = new MemoryStudioPersistenceStore();
    const model = createEmptyStudioPersistenceModel(projectPath);
    model.windows.push(...canonicalModel.windows);

    await writeStudioDocument(projectPath, store, model);

    const written = store.files.get(getStudioDocumentRelativePath());
    expect(written).toContain("resourceType: studio_document");
    expect(written).toContain("windows:");
    expect(written).toContain("workbenches:");
    expect(written).toContain("layouts:");
  });

  it("loads shorthand default workbenches to the same canonical model as explicit layouts", async () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";
    const store = new MemoryStudioPersistenceStore();
    store.files.set(
      getStudioDocumentRelativePath(),
      [
        "resourceType: studio_document",
        "schemaVersion: 1",
        "id: barr-e-studio",
        "windows:",
        "  - id: main",
        "    label: Main Window",
        "    windowRole: main",
        "    defaultWorkbenchId: remote-control",
        "    workbenches:",
        "      - id: remote-control",
        "        label: Remote Control",
        "        defaultEditorId: terminal",
      ].join("\n")
    );

    await expect(loadStudioDocument(projectPath, store)).resolves.toEqual(
      defaultCanonicalModel
    );
  });

  it("writes only the diff for default single-panel layouts", async () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";
    const store = new MemoryStudioPersistenceStore();

    await writeStudioDocument(projectPath, store, defaultCanonicalModel);

    const written = store.files.get(getStudioDocumentRelativePath()) ?? "";
    expect(written).toContain("defaultEditorId: terminal");
    expect(written).not.toContain("path:");
    expect(written).not.toContain("defaultLayoutId:");
    expect(written).not.toContain("layouts:");
    expect(written).not.toContain("panelId:");
  });

  it("preserves explicit layouts when they differ from defaults", async () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";
    const store = new MemoryStudioPersistenceStore();
    const customModel: StudioPersistenceModel = {
      ...canonicalModel,
      windows: [
        {
          ...canonicalModel.windows[0]!,
          workbenches: [
            {
              ...canonicalModel.windows[0]!.workbenches[0]!,
              layouts: [
                {
                  id: "main:remote-control:default",
                  label: "Default",
                  dock: {
                    nodeType: "panel",
                    panelId: "custom-panel",
                    editorId: "terminal",
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    await writeStudioDocument(projectPath, store, customModel);

    const written = store.files.get(getStudioDocumentRelativePath()) ?? "";
    expect(written).toContain("layouts:");
    expect(written).toContain("panelId: custom-panel");
  });

  it("preserves non-default workbench paths", async () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";
    const store = new MemoryStudioPersistenceStore();
    const customPathModel: StudioPersistenceModel = {
      ...defaultCanonicalModel,
      windows: [
        {
          ...defaultCanonicalModel.windows[0]!,
          workbenches: [
            {
              ...defaultCanonicalModel.windows[0]!.workbenches[0]!,
              path: "/teleop",
            },
          ],
        },
      ],
    };

    await writeStudioDocument(projectPath, store, customPathModel);

    const written = store.files.get(getStudioDocumentRelativePath()) ?? "";
    expect(written).toContain("path: /teleop");
  });

  it("falls back to the bundled seed when no canonical document is present", async () => {
    const projectPath = "/repo/robots/barr-e/barr-e.project.yaml";
    const store = new MemoryStudioPersistenceStore();

    const loaded = await loadStudioPersistence(projectPath, store);

    expect(loaded.source).toBe("seed");
    expect(loaded.model.resourceType).toBe("studio_document");
    expect(loaded.model.windows[0]?.id).toBe("main");
    expect(loaded.model.windows[0]?.workbenches.length).toBeGreaterThan(0);
    expect(store.files.size).toBe(0);
  });
});
