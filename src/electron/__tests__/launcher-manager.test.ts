import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspaceRoot } from "../main/launcher-manager";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "robotick-launcher-manager-")
  );
  tempDirs.push(dir);
  return dir;
}

describe("resolveWorkspaceRoot", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("prefers the configured workspace root from the environment", () => {
    const configuredRoot = makeTempDir();

    expect(
      resolveWorkspaceRoot(
        { ROBOTICK_WORKSPACE_ROOT: configuredRoot },
        "/ignored/cwd",
        "/ignored/module"
      )
    ).toBe(configuredRoot);
  });

  it("walks up from a studio subdirectory to find the repo workspace root", () => {
    const workspaceRoot = makeTempDir();
    fs.mkdirSync(path.join(workspaceRoot, ".studio"));
    fs.mkdirSync(path.join(workspaceRoot, "robots"));
    const studioDir = path.join(
      workspaceRoot,
      "robotick",
      "robotick-studio"
    );
    fs.mkdirSync(studioDir, { recursive: true });

    expect(resolveWorkspaceRoot({}, studioDir, studioDir)).toBe(workspaceRoot);
  });
});
