const PRIMARY_WINDOW_SCOPE = "primary";

export function getWindowScope(): string {
  if (typeof window === "undefined") {
    return PRIMARY_WINDOW_SCOPE;
  }
  const scope = window.robotick?.environment?.windowScope;
  return typeof scope === "string" && scope.trim().length > 0
    ? scope
    : PRIMARY_WINDOW_SCOPE;
}

export function isPrimaryWindowSession(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return window.robotick?.environment?.isPrimaryWindow !== false;
}

export function shouldConfirmCloseChildWindow(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return !isPrimaryWindowSession();
}
