import fs from "fs";
import path from "path";
import type { IpcMain } from "electron";

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

function getStudioDocumentPath(projectPath: string): string {
  return path.join(resolveProjectDirectory(projectPath), "studio", "studio.yaml");
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, content, "utf-8");
  await fs.promises.rename(tempPath, filePath);
}

export function registerStudioPersistence(ipcMain: IpcMain) {
  ipcMain.handle(
    "robotick-studio-persistence:read",
    async (_event, payload: { projectPath: string }) => {
      const filePath = getStudioDocumentPath(payload.projectPath);
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
    async (_event, payload: { projectPath: string; content: string }) => {
      const filePath = getStudioDocumentPath(payload.projectPath);
      await writeFileAtomic(filePath, payload.content);
    }
  );
}
