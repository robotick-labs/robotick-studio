import fs from "fs";
import path from "path";
import type { IpcMain } from "electron";

type StudioResourceDirectory = "windows" | "workbenches" | "layouts";

const DIRECTORY_SUFFIXES: Record<StudioResourceDirectory, string> = {
  windows: ".window.json",
  workbenches: ".workbench.json",
  layouts: ".layout.json",
};

function looksLikeProjectFilePath(value: string): boolean {
  return /\.(ya?ml|json|toml)$/i.test(value.trim());
}

function resolveProjectDirectory(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  if (looksLikeProjectFilePath(projectPath)) {
    return path.dirname(resolved);
  }
  try {
    return fs.statSync(resolved).isFile() ? path.dirname(resolved) : resolved;
  } catch {
    return resolved;
  }
}

function assertInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project studio directory: ${candidate}`);
  }
}

function getStudioRoot(projectPath: string): string {
  return path.join(resolveProjectDirectory(projectPath), "studio");
}

function resolveStudioResourcePath(
  projectPath: string,
  resourcePath: string
): string {
  if (path.isAbsolute(resourcePath)) {
    throw new Error(`Studio resource path must be project-relative: ${resourcePath}`);
  }
  const normalized = resourcePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith("studio/")) {
    throw new Error(`Studio resource path must start with studio/: ${resourcePath}`);
  }
  const studioRoot = getStudioRoot(projectPath);
  const resolved = path.resolve(resolveProjectDirectory(projectPath), normalized);
  assertInside(studioRoot, resolved);
  return resolved;
}

function safeParseRendererStorage(content: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(content);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((value) => typeof value === "string")
    ) {
      return parsed as Record<string, string>;
    }
  } catch {
    // fall through
  }
  return null;
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, content, "utf-8");
  await fs.promises.rename(tempPath, filePath);
}

export function registerStudioPersistence(ipcMain: IpcMain) {
  ipcMain.handle(
    "robotick-studio-persistence:list",
    async (
      _event,
      payload: { projectPath: string; directory: StudioResourceDirectory }
    ) => {
      const suffix = DIRECTORY_SUFFIXES[payload.directory];
      if (!suffix) {
        return [];
      }
      const directoryPath = path.join(getStudioRoot(payload.projectPath), payload.directory);
      try {
        const entries = await fs.promises.readdir(directoryPath, {
          withFileTypes: true,
        });
        return entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
          .map((entry) =>
            path.posix.join("studio", payload.directory, entry.name)
          )
          .sort();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw error;
      }
    }
  );

  ipcMain.handle(
    "robotick-studio-persistence:read",
    async (_event, payload: { projectPath: string; resourcePath: string }) => {
      const filePath = resolveStudioResourcePath(
        payload.projectPath,
        payload.resourcePath
      );
      try {
        return await fs.promises.readFile(filePath, "utf-8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    }
  );

  ipcMain.handle(
    "robotick-studio-persistence:write",
    async (
      _event,
      payload: { projectPath: string; resourcePath: string; content: string }
    ) => {
      const filePath = resolveStudioResourcePath(
        payload.projectPath,
        payload.resourcePath
      );
      await writeFileAtomic(filePath, payload.content);
    }
  );

  ipcMain.handle(
    "robotick-studio-persistence:read-legacy-renderer-storage",
    async (_event, payload: { projectPath: string }) => {
      const filePath = path.join(
        resolveProjectDirectory(payload.projectPath),
        ".studio",
        "renderer-storage.json"
      );
      try {
        return safeParseRendererStorage(
          await fs.promises.readFile(filePath, "utf-8")
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    }
  );
}
