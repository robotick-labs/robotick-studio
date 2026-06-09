import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectLockConflictError,
  acquireProjectLock,
  getProjectLockPath,
  readProjectLockStatus,
  releaseProjectLock,
} from "../../main/project-locks";

function createProjectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "robotick-project-lock-"));
}

describe("project lock ownership", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("acquires and releases the current instance lock", () => {
    const projectDir = createProjectDir();
    projectDirs.push(projectDir);
    const owner = {
      pid: process.pid,
      instanceName: "studio-test",
    };

    const status = acquireProjectLock(projectDir, owner);
    expect(status.state).toBe("current");
    expect(fs.existsSync(getProjectLockPath(projectDir))).toBe(true);

    releaseProjectLock(projectDir, owner);
    expect(fs.existsSync(getProjectLockPath(projectDir))).toBe(false);
  });

  it("rejects a lock owned by another live instance", () => {
    const projectDir = createProjectDir();
    projectDirs.push(projectDir);
    const lockPath = getProjectLockPath(projectDir);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        {
          pid: process.pid,
          instanceName: "studio-9999",
          projectPath: projectDir,
        },
        null,
        2
      ),
      "utf-8"
    );

    expect(() =>
      acquireProjectLock(projectDir, {
        pid: process.ppid,
        instanceName: "studio-other",
      })
    ).toThrow(ProjectLockConflictError);
  });

  it("drops stale locks before reporting availability", () => {
    const projectDir = createProjectDir();
    projectDirs.push(projectDir);
    const lockPath = getProjectLockPath(projectDir);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        {
          pid: 999999,
          instanceName: "studio-stale",
          projectPath: projectDir,
        },
        null,
        2
      ),
      "utf-8"
    );

    const status = readProjectLockStatus(projectDir, {
      pid: process.pid,
      instanceName: "studio-test",
    });

    expect(status.state).toBe("available");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("treats unreadable lock payloads as stale", () => {
    const projectDir = createProjectDir();
    projectDirs.push(projectDir);
    const lockPath = getProjectLockPath(projectDir);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "{not-json", "utf-8");

    const status = readProjectLockStatus(projectDir, {
      pid: process.pid,
      instanceName: "studio-test",
    });

    expect(status.state).toBe("available");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("locks the project directory when selection uses a project yaml path", () => {
    const projectDir = createProjectDir();
    projectDirs.push(projectDir);
    const projectYamlPath = path.join(projectDir, "barr-e.project.yaml");
    fs.writeFileSync(projectYamlPath, "name: Barr-E\n", "utf-8");
    const owner = {
      pid: process.pid,
      instanceName: "studio-test",
    };

    const status = acquireProjectLock(projectYamlPath, owner);

    expect(status.projectPath).toBe(projectYamlPath);
    expect(fs.existsSync(path.join(projectDir, "studio", "studio.lock"))).toBe(true);

    releaseProjectLock(projectYamlPath, owner);
    expect(fs.existsSync(path.join(projectDir, "studio", "studio.lock"))).toBe(false);
  });
});
