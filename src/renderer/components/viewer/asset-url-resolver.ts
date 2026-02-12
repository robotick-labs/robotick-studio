import { buildProjectAssetUrl } from "../../data-sources/launcher/internal/launcher-interface";

function hasScheme(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url);
}

function isHttpScheme(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function resolveViewerAssetUrl(
  rawUrl: string,
  projectPath?: string
): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("Viewer asset URL is empty.");
  }

  if (isHttpScheme(trimmed)) {
    return trimmed;
  }

  if (hasScheme(trimmed)) {
    throw new Error(
      `Unsupported viewer asset URL scheme: ${trimmed}. Use project-relative paths or http(s) URLs.`
    );
  }

  if (trimmed.startsWith("/")) {
    throw new Error(
      `Unsupported absolute viewer asset path: ${trimmed}. Use a project-relative path.`
    );
  }

  const normalizedProjectPath = projectPath?.trim();
  if (!normalizedProjectPath) {
    throw new Error(
      `Cannot resolve project-relative asset path "${trimmed}" without an active project path.`
    );
  }

  return buildProjectAssetUrl(normalizedProjectPath, trimmed);
}
