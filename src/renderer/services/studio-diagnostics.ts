type RendererDiagnosticsSnapshot = Record<string, unknown> & {
  updated_at?: string;
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
const MAX_FAILURE_RECORDS = 50;

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

export function publishRendererDiagnosticsPatch(
  patch: Record<string, unknown>
): void {
  currentSnapshot = {
    ...currentSnapshot,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  if (!canPublishDiagnostics()) {
    return;
  }
  window.robotick?.diagnostics?.publishSnapshot(currentSnapshot);
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
    url: input.url,
    status_code:
      typeof input.statusCode === "number" ? input.statusCode : null,
    message: input.message,
  };
  publishRendererDiagnosticsPatch({
    fetch_failures: pushBounded(
      currentSnapshot.fetch_failures as RendererFetchFailureRecord[] | undefined,
      record
    ),
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
    url: input.url,
    message: input.message,
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
}

export function getRendererDiagnosticsSnapshot(): RendererDiagnosticsSnapshot {
  return { ...currentSnapshot };
}

export function resetRendererDiagnosticsForTests(): void {
  currentSnapshot = {};
}
