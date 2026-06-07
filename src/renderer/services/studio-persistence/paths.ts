import { STUDIO_RESOURCE_DIRECTORIES } from "./constants";

function trimTrailingSeparators(value: string): string {
  if (value === "/" || /^[A-Za-z]:\\?$/.test(value)) {
    return value;
  }
  return value.replace(/[\\/]+$/, "");
}

function detectSeparator(value: string): "/" | "\\" {
  return value.includes("\\") && !value.includes("/") ? "\\" : "/";
}

function getParentDirectory(value: string): string {
  const trimmed = trimTrailingSeparators(value.trim());
  const lastSlash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (lastSlash < 0) {
    return ".";
  }
  if (lastSlash === 0) {
    return trimmed[0];
  }
  if (lastSlash === 2 && trimmed[1] === ":") {
    return trimmed.slice(0, 3);
  }
  return trimmed.slice(0, lastSlash);
}

function joinPathParts(
  separator: "/" | "\\",
  ...parts: Array<string | undefined>
): string {
  const filtered = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part, index) => {
      const trimmed = part.trim();
      if (index === 0) {
        return trimTrailingSeparators(trimmed);
      }
      return trimmed.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
    });
  if (filtered.length === 0) {
    return "";
  }
  return filtered.join(separator);
}

export function getStudioProjectDirectory(projectPath: string): string {
  return getParentDirectory(projectPath);
}

export function getStudioRootPath(projectPath: string): string {
  const separator = detectSeparator(projectPath);
  return joinPathParts(
    separator,
    getStudioProjectDirectory(projectPath),
    STUDIO_RESOURCE_DIRECTORIES.root
  );
}

export function getStudioWindowsDirectoryPath(projectPath: string): string {
  const separator = detectSeparator(projectPath);
  return joinPathParts(
    separator,
    getStudioRootPath(projectPath),
    STUDIO_RESOURCE_DIRECTORIES.windows
  );
}

export function getStudioWorkbenchesDirectoryPath(projectPath: string): string {
  const separator = detectSeparator(projectPath);
  return joinPathParts(
    separator,
    getStudioRootPath(projectPath),
    STUDIO_RESOURCE_DIRECTORIES.workbenches
  );
}

export function getStudioLayoutsDirectoryPath(projectPath: string): string {
  const separator = detectSeparator(projectPath);
  return joinPathParts(
    separator,
    getStudioRootPath(projectPath),
    STUDIO_RESOURCE_DIRECTORIES.layouts
  );
}

export function getStudioWindowResourcePath(
  projectPath: string,
  slug: string
): string {
  const separator = detectSeparator(projectPath);
  return joinPathParts(
    separator,
    getStudioWindowsDirectoryPath(projectPath),
    `${slug}.window.json`
  );
}

export function getStudioWorkbenchResourcePath(
  projectPath: string,
  slug: string
): string {
  const separator = detectSeparator(projectPath);
  return joinPathParts(
    separator,
    getStudioWorkbenchesDirectoryPath(projectPath),
    `${slug}.workbench.json`
  );
}

export function getStudioLayoutResourcePath(
  projectPath: string,
  slug: string
): string {
  const separator = detectSeparator(projectPath);
  return joinPathParts(
    separator,
    getStudioLayoutsDirectoryPath(projectPath),
    `${slug}.layout.json`
  );
}

export function getStudioResourcePaths(projectPath: string) {
  return {
    projectDirectory: getStudioProjectDirectory(projectPath),
    studioRoot: getStudioRootPath(projectPath),
    windowsDirectory: getStudioWindowsDirectoryPath(projectPath),
    workbenchesDirectory: getStudioWorkbenchesDirectoryPath(projectPath),
    layoutsDirectory: getStudioLayoutsDirectoryPath(projectPath),
  };
}
