import fs from "fs";
import path from "path";
import { parse } from "yaml";

export type StudioProjectMetadata = {
  projectId: string | null;
  projectDirectory: string | null;
  projectFileName: string | null;
  projectDisplayName: string | null;
};

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function deriveProjectId(projectPath: string): string {
  return path.basename(projectPath).replace(/\.project\.ya?ml$/i, "");
}

export function readProjectMetadata(
  projectPath: string | null
): StudioProjectMetadata {
  if (!projectPath) {
    return {
      projectId: null,
      projectDirectory: null,
      projectFileName: null,
      projectDisplayName: null,
    };
  }
  const projectFileName = path.basename(projectPath);
  const projectDirectory = path.dirname(projectPath);
  const projectId = deriveProjectId(projectPath);
  let projectDisplayName: string | null = null;
  try {
    const loaded = parse(fs.readFileSync(projectPath, "utf-8")) as {
      name?: unknown;
    } | null;
    if (loaded && typeof loaded === "object" && typeof loaded.name === "string") {
      projectDisplayName = trimOrNull(loaded.name);
    }
  } catch {
    // Fall back to the project id below.
  }
  return {
    projectId,
    projectDirectory,
    projectFileName,
    projectDisplayName: projectDisplayName ?? projectId,
  };
}
