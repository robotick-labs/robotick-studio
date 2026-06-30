const rendererStartupBaselineMs =
  typeof performance !== "undefined" ? performance.now() : 0;

export function msSinceRendererStartup(): number {
  if (typeof performance === "undefined") {
    return 0;
  }
  return Math.round((performance.now() - rendererStartupBaselineMs) * 1000) / 1000;
}
