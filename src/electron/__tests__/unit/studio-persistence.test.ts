import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSeedStudioDocument,
  ensureChildWindowInDocument,
  ensureStudioDocument,
  getStudioDocumentPath,
  mergeWindowIntoDocument,
} from "../../main/studio-persistence";

function readStudioDocument(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

const tempDirs: string[] = [];

function createTempProjectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("studio-persistence main helpers", () => {
  it("materializes the bundled seed document on first ensure", async () => {
    const projectDir = createTempProjectDir();

    const document = await ensureStudioDocument(projectDir);
    const filePath = getStudioDocumentPath(projectDir);

    expect(document.id).toBe(`${path.basename(projectDir)}-studio`);
    expect(document.windows[0]?.id).toBe("main");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(readStudioDocument(filePath)).toContain("resourceType: studio_document");
  });

  it("adds a child window to the canonical document without disturbing the main window", async () => {
    const projectDir = createTempProjectDir();

    await ensureStudioDocument(projectDir);
    const document = await ensureChildWindowInDocument(projectDir, "child-telemetry");

    expect(document.windows.map((window) => window.id)).toContain("main");
    expect(document.windows.map((window) => window.id)).toContain("child-telemetry");
    expect(
      document.windows.find((window) => window.id === "child-telemetry")?.windowRole
    ).toBe("child");
  });

  it("merges only the submitted window into the current canonical document", () => {
    const current = createSeedStudioDocument("/tmp/barr-e");
    current.windows.push({
      id: "child-a",
      label: "Studio Window",
      windowRole: "child",
      defaultWorkbenchId: "home",
      workbenches: [
        {
          id: "home",
          label: "Home",
          path: "/home",
          group: "project-select",
          defaultEditorId: "home",
          defaultLayoutId: "child-a:home:default",
          layouts: [
            {
              id: "child-a:home:default",
              label: "Default",
              dock: {
                nodeType: "panel",
                panelId: "child-panel",
                editorId: "home",
              },
            },
          ],
        },
      ],
    });

    const incoming = createSeedStudioDocument("/tmp/barr-e");
    incoming.windows[0]!.label = "Renamed Main Window";
    incoming.windows[0]!.workbenches[0]!.label = "Renamed Home";

    const merged = mergeWindowIntoDocument(current, incoming, "primary");

    expect(merged.windows.find((window) => window.id === "main")?.label).toBe(
      "Renamed Main Window"
    );
    expect(
      merged.windows.find((window) => window.id === "child-a")?.workbenches[0]?.label
    ).toBe("Home");
  });
});
