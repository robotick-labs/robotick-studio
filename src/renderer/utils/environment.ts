export function isStandaloneElectron(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.robotick?.environment?.isStandaloneApp) {
    return true;
  }
  const userAgent = window.navigator?.userAgent || "";
  return /electron/i.test(userAgent);
}
