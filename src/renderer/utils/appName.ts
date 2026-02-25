const FALLBACK_APP_NAME = "Robotick Hub";

// Use the Electron-provided display name when available, otherwise keep the Hub branding.
export function getRendererAppName(): string {
  if (typeof window === "undefined") {
    return FALLBACK_APP_NAME;
  }

  const environment = window.robotick?.environment;
  if (
    environment?.isStandaloneApp &&
    typeof environment.appTitle === "string" &&
    environment.appTitle.trim()
  ) {
    return environment.appTitle.trim();
  }

  return FALLBACK_APP_NAME;
}

export const DEFAULT_RENDERER_APP_NAME = FALLBACK_APP_NAME;
