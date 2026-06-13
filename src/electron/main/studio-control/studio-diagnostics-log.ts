import type { StudioControlDiagnosticsConsoleRecord } from "../../common/studio-control-contract";

export type StudioDiagnosticsLogTarget = "runtime" | "studio";

export type StudioDiagnosticsLogSource =
  | "electron_main"
  | "renderer_console"
  | "renderer_error"
  | "renderer_fetch"
  | "renderer_websocket"
  | "control_service"
  | `plugin:${string}`;

export type StudioDiagnosticsLogSeverity = "debug" | "info" | "warn" | "error";

export type StudioDiagnosticsLogRecord = {
  target: StudioDiagnosticsLogTarget;
  source: StudioDiagnosticsLogSource;
  window_id: string | null;
  recorded_at: string;
  level: StudioDiagnosticsLogSeverity;
  message: string;
  source_url: string | null;
  line: number | null;
  column: number | null;
  stack: string | null;
  payload: Record<string, unknown> | null;
};

export type StudioDiagnosticsLogInput = Partial<
  Omit<StudioDiagnosticsLogRecord, "recorded_at" | "target">
> & {
  message: string;
  target?: StudioDiagnosticsLogTarget;
};

export function normalizeConsoleLevel(value: unknown): StudioDiagnosticsLogSeverity {
  if (typeof value === "number") {
    if (value >= 3) {
      return "error";
    }
    if (value === 2) {
      return "warn";
    }
    if (value === 0) {
      return "debug";
    }
    return "info";
  }
  if (typeof value !== "string") {
    return "info";
  }
  const normalized = value.toLowerCase();
  if (normalized === "warning") {
    return "warn";
  }
  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error"
  ) {
    return normalized;
  }
  return "info";
}

export class StudioDiagnosticsLogStore {
  private readonly limit: number;
  private readonly records: StudioDiagnosticsLogRecord[] = [];

  constructor(limit = 500) {
    this.limit = Math.max(1, limit);
  }

  record(input: StudioDiagnosticsLogInput): StudioDiagnosticsLogRecord {
    const record: StudioDiagnosticsLogRecord = {
      target: input.target ?? "studio",
      source: input.source ?? "electron_main",
      window_id: input.window_id ?? null,
      recorded_at: new Date().toISOString(),
      level: input.level ?? "info",
      message: input.message,
      source_url: input.source_url ?? null,
      line: typeof input.line === "number" ? input.line : null,
      column: typeof input.column === "number" ? input.column : null,
      stack: input.stack ?? null,
      payload: input.payload ?? null,
    };
    this.records.push(record);
    if (this.records.length > this.limit) {
      this.records.splice(0, this.records.length - this.limit);
    }
    return record;
  }

  list(options?: {
    windowId?: string | null;
    target?: StudioDiagnosticsLogTarget;
    sources?: StudioDiagnosticsLogSource[];
    levels?: StudioDiagnosticsLogSeverity[];
    tail?: number;
  }): StudioDiagnosticsLogRecord[] {
    const sourceSet = options?.sources ? new Set(options.sources) : null;
    const levelSet = options?.levels ? new Set(options.levels) : null;
    const filtered = this.records.filter((record) => {
      if (options?.target && record.target !== options.target) {
        return false;
      }
      if (options?.windowId !== undefined && record.window_id !== options.windowId) {
        return false;
      }
      if (sourceSet && !sourceSet.has(record.source)) {
        return false;
      }
      if (levelSet && !levelSet.has(record.level)) {
        return false;
      }
      return true;
    });
    const tail = options?.tail;
    if (typeof tail === "number" && tail >= 0 && filtered.length > tail) {
      return filtered.slice(filtered.length - tail);
    }
    return filtered.slice();
  }

  consoleRecords(options?: {
    windowId?: string | null;
    tail?: number;
    levels?: StudioDiagnosticsLogSeverity[];
  }): StudioControlDiagnosticsConsoleRecord[] {
    return this.list({
      windowId: options?.windowId,
      tail: options?.tail,
      levels: options?.levels,
      sources: ["renderer_console", "renderer_error"],
      target: "studio",
    }).map((record) => ({
      window_id: record.window_id,
      recorded_at: record.recorded_at,
      level: record.level,
      message: record.message,
      source_url: record.source_url,
      line: record.line,
      column: record.column,
      stack: record.stack,
      payload: record.payload,
    }));
  }
}
