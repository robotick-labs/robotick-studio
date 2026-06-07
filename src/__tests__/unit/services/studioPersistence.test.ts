import { describe, expect, it } from "vitest";
import {
  STUDIO_PERSISTENCE_SCHEMA_VERSION,
  getStudioLayoutResourcePath,
  getStudioProjectDirectory,
  getStudioResourcePaths,
  getStudioRootPath,
  getStudioWindowResourcePath,
  getStudioWorkbenchResourcePath,
} from "../../../renderer/services/studio-persistence";

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
});
