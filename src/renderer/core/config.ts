const env = import.meta.env ?? {};

const withDefault = (value: string | undefined, fallback: string) =>
  value && value.length > 0 ? value : fallback;

export const LAUNCHER_LOCAL_API_BASE = withDefault(
  env.VITE_LAUNCHER_LOCAL_API_BASE,
  "http://localhost:7081"
);
export const RC_TELEMETRY_BASE = withDefault(
  env.VITE_RC_TELEMETRY_BASE,
  "http://localhost:7091"
);
export const REMOTE_CONTROL_BASE = withDefault(
  env.VITE_REMOTE_CONTROL_BASE,
  "http://localhost:7080"
);

export const POLLING_DEFAULT_INTERVAL_MS = 1000;
export const POLLING_FAST_INTERVAL_MS = 200;
