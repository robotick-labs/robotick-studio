type RendererDiagnosticsSnapshot = Record<string, unknown> & {
  updated_at?: string;
};

export type RendererDiagnosticsProvider = () => Record<string, unknown> | null | undefined;

export type RendererDiagnosticsEventLevel = "debug" | "info" | "warn" | "error";

export type RendererDiagnosticsEvent = {
  source: string;
  level?: RendererDiagnosticsEventLevel;
  message: string;
  payload?: Record<string, unknown> | null;
};

type RendererFetchFailureRecord = {
  recorded_at: string;
  source: string;
  operation: string;
  url: string;
  status_code: number | null;
  message: string;
};

type RendererWebSocketFailureRecord = {
  recorded_at: string;
  source: string;
  phase: string;
  url: string;
  message: string;
  close_code: number | null;
};

let currentSnapshot: RendererDiagnosticsSnapshot = {};
const providers = new Map<string, RendererDiagnosticsProvider>();
const MAX_FAILURE_RECORDS = 50;
const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN = /(auth|authorization|password|secret|token|api[-_]?key|access[-_]?key|credential)/i;

function pushBounded<T>(existing: T[] | undefined, record: T): T[] {
  const next = [...(existing ?? []), record];
  if (next.length > MAX_FAILURE_RECORDS) {
    next.splice(0, next.length - MAX_FAILURE_RECORDS);
  }
  return next;
}

function canPublishDiagnostics(): boolean {
  return typeof window !== "undefined" && Boolean(window.robotick?.diagnostics);
}

function redactString(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/([?&](?:token|access_token|api_key|key|secret)=)[^&#\s]+/gi, `$1${REDACTED}`);
}

function redactDiagnosticsValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticsValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : redactDiagnosticsValue(nestedValue);
  }
  return output;
}

function collectProviderSnapshot(): Record<string, unknown> {
  const diagnosticsProviders: Record<string, unknown> = {};
  for (const [id, provider] of providers.entries()) {
    try {
      diagnosticsProviders[id] = redactDiagnosticsValue(provider() ?? null);
    } catch (error) {
      diagnosticsProviders[id] = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return Object.keys(diagnosticsProviders).length > 0
    ? { diagnostics_providers: diagnosticsProviders }
    : {};
}

function publishCurrentSnapshot(): void {
  if (!canPublishDiagnostics()) {
    return;
  }
  window.robotick?.diagnostics?.publishSnapshot({
    ...currentSnapshot,
    ...collectProviderSnapshot(),
  });
}

export function publishRendererDiagnosticsPatch(
  patch: Record<string, unknown>
): void {
  currentSnapshot = {
    ...currentSnapshot,
    ...(redactDiagnosticsValue(patch) as Record<string, unknown>),
    updated_at: new Date().toISOString(),
  };
  publishCurrentSnapshot();
}

export function resetProjectScopedRendererDiagnostics(
  projectPath?: string
): void {
  currentSnapshot = {
    ...currentSnapshot,
    fetch_failures: [],
    websocket_failures: [],
    telemetry: null,
    project_diagnostics_scope: {
      project_path: projectPath?.trim() || null,
      reset_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  };
  publishCurrentSnapshot();
}

export function registerRendererDiagnosticsProvider(
  id: string,
  provider: RendererDiagnosticsProvider
): () => void {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new Error("Renderer diagnostics provider id is required.");
  }
  providers.set(normalizedId, provider);
  publishCurrentSnapshot();
  return () => {
    if (providers.get(normalizedId) === provider) {
      providers.delete(normalizedId);
      publishCurrentSnapshot();
    }
  };
}

export function publishRendererDiagnosticsEvent(event: RendererDiagnosticsEvent): void {
  const source = event.source.trim();
  const message = event.message.trim();
  if (!source || !message || !canPublishDiagnostics()) {
    return;
  }
  const publishEvent = window.robotick?.diagnostics?.publishEvent;
  if (!publishEvent) {
    return;
  }
  publishEvent({
    source,
    level: event.level ?? "info",
    message,
    payload: (redactDiagnosticsValue(event.payload ?? null) ?? null) as
      | Record<string, unknown>
      | null,
  });
}

export function recordRendererFetchFailure(input: {
  source: string;
  operation: string;
  url: string;
  statusCode?: number | null;
  message: string;
}): void {
  const record: RendererFetchFailureRecord = {
    recorded_at: new Date().toISOString(),
    source: input.source,
    operation: input.operation,
    url: redactString(input.url),
    status_code:
      typeof input.statusCode === "number" ? input.statusCode : null,
    message: redactString(input.message),
  };
  publishRendererDiagnosticsPatch({
    fetch_failures: pushBounded(
      currentSnapshot.fetch_failures as RendererFetchFailureRecord[] | undefined,
      record
    ),
  });
  publishRendererDiagnosticsEvent({
    source: "renderer_fetch",
    level: "error",
    message: record.message,
    payload: record,
  });
}

export function recordRendererWebSocketFailure(input: {
  source: string;
  phase: string;
  url: string;
  message: string;
  closeCode?: number | null;
}): void {
  const record: RendererWebSocketFailureRecord = {
    recorded_at: new Date().toISOString(),
    source: input.source,
    phase: input.phase,
    url: redactString(input.url),
    message: redactString(input.message),
    close_code: typeof input.closeCode === "number" ? input.closeCode : null,
  };
  publishRendererDiagnosticsPatch({
    websocket_failures: pushBounded(
      currentSnapshot.websocket_failures as
        | RendererWebSocketFailureRecord[]
        | undefined,
      record
    ),
  });
  publishRendererDiagnosticsEvent({
    source: "renderer_websocket",
    level: "error",
    message: record.message,
    payload: record,
  });
}

export async function requestRendererCommand(
  commandId: string,
  input?: Record<string, unknown>
): Promise<unknown> {
  const normalizedId = commandId.trim();
  if (!normalizedId) {
    throw new Error("Renderer command id is required.");
  }
  if (!canPublishDiagnostics() || !window.robotick?.diagnostics?.requestCommand) {
    return {
      accepted: false,
      error: "renderer_command_bridge_unavailable",
    };
  }
  return window.robotick.diagnostics.requestCommand(normalizedId, input ?? {});
}

export function getRendererDiagnosticsSnapshot(): RendererDiagnosticsSnapshot {
  return {
    ...currentSnapshot,
    ...collectProviderSnapshot(),
  };
}

export function resetRendererDiagnosticsForTests(): void {
  currentSnapshot = {};
  providers.clear();
}
