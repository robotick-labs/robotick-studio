type ViewDiagnosticsPayload = {
  view: string;
  timestamp: number;
  data?: Record<string, unknown>;
};

function assignPayload(payload: ViewDiagnosticsPayload) {
  if (typeof window !== "undefined") {
    (window as Window & { __ROBOTICK_VIEW__?: ViewDiagnosticsPayload }).__ROBOTICK_VIEW__ =
      payload;
  }
}

export function reportViewDiagnostics(
  view: string,
  data?: Record<string, unknown>
): ViewDiagnosticsPayload {
  const payload: ViewDiagnosticsPayload = {
    view,
    timestamp: Date.now(),
    data,
  };
  assignPayload(payload);
  if (typeof console !== "undefined" && typeof console.info === "function") {
    console.info("[Robotick] View diagnostics", payload);
  }
  return payload;
}

export function getLastViewDiagnostics():
  | ViewDiagnosticsPayload
  | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return (window as Window & { __ROBOTICK_VIEW__?: ViewDiagnosticsPayload })
    .__ROBOTICK_VIEW__;
}

declare global {
  interface Window {
    __ROBOTICK_VIEW__?: ViewDiagnosticsPayload;
  }
}
