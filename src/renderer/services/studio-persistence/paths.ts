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

function looksLikeProjectFilePath(value: string): boolean {
  return /\.(ya?ml|json|toml)$/i.test(value.trim());
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
  if (!looksLikeProjectFilePath(projectPath)) {
    return trimTrailingSeparators(projectPath.trim());
  }
  return getParentDirectory(projectPath);
}

export function getStudioRootPath(projectPath: string): string {
  const separator = detectSeparator(projectPath);
  return joinPathParts(separator, getStudioProjectDirectory(projectPath), "studio");
}

export function getStudioDocumentRelativePath(): string {
  return "studio/studio.yaml";
}

export function getStudioDocumentPath(projectPath: string): string {
  const separator = detectSeparator(projectPath);
  return joinPathParts(separator, getStudioRootPath(projectPath), "studio.yaml");
}

export function getStudioResourcePaths(projectPath: string) {
  return {
    projectDirectory: getStudioProjectDirectory(projectPath),
    studioRoot: getStudioRootPath(projectPath),
    studioDocument: getStudioDocumentPath(projectPath),
  };
}
