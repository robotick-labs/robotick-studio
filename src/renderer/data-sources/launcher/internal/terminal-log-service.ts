import { readStorageValue, setStorageValue } from "../../../services/storage";
import { launcherEvents } from "./LauncherContext";
import type { LauncherModelLogEvent } from "./launcher-interface";
import { launcherService } from "./LauncherService";
import { createPollingTask } from "../../../utils/polling";
import { isAppQuitting } from "../../../utils/appQuitting";
import { recordRendererWebSocketFailure } from "../../../services/studio-diagnostics";
import type { RobotickDiagnosticsLogRecord } from "../../../types/robotick-globals";

type TerminalLogSubscriber = () => void;
export type TerminalLogTarget = "runtime" | "studio";

export type TerminalLogMessage =
  | {
      kind: "text";
      target: "runtime";
      source: "plain-text";
      text: string;
    }
  | {
      kind: "launcher-event";
      target: "runtime";
      event: LauncherModelLogEvent;
    }
  | {
      kind: "studio-event";
      target: "studio";
      event: RobotickDiagnosticsLogRecord;
    };

export interface TerminalLogService {
  subscribe(listener: TerminalLogSubscriber): () => void;
  getMessages(): TerminalLogMessage[];
  getStats(): TerminalLogStats;
  clearMessages(): void;
  getClearOnRun(): boolean;
  setClearOnRun(enabled: boolean): void;
}

export type TerminalLogStats = {
  totalReceived: number;
  bufferedCount: number;
  droppedCount: number;
  flushIntervalMs: number;
};

const MAX_MESSAGES = 5000;
const STORAGE_KEYS = {
  clearOnRun: "robotick-studio.terminal.clearOnRun",
} as const;
const HAS_WEBSOCKET = typeof globalThis.WebSocket !== "undefined";
const IS_TEST_ENV =
  typeof process !== "undefined" &&
  typeof process.env !== "undefined" &&
  process.env.NODE_ENV === "test";

function readBoolean(key: string, fallback: boolean): boolean {
  const raw = readStorageValue(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function writeBoolean(key: string, value: boolean) {
  setStorageValue(key, value ? "true" : "false");
}

const RECONNECT_MIN_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 8000;
const SNAPSHOT_TAIL_LINES = 300;
const STUDIO_SNAPSHOT_TAIL_LINES = 300;
const FLUSH_INTERVAL_MS = 32;

function getDiagnosticsBridge() {
  return typeof window !== "undefined" ? window.robotick?.diagnostics : undefined;
}

export function parseTerminalLogMessage(text: string): TerminalLogMessage {
  try {
    const parsed = JSON.parse(text) as Partial<LauncherModelLogEvent> & {
      resource_type?: string;
    };
    if (
      parsed.resource_type === "robotick_launcher_model_log_event" &&
      typeof parsed.model_id === "string" &&
      typeof parsed.source_kind === "string" &&
      typeof parsed.line === "string"
    ) {
      return {
        kind: "launcher-event",
        target: "runtime",
        event: parsed as LauncherModelLogEvent,
      };
    }
  } catch {
    // Plain text streams remain supported for diagnostics and compatibility.
  }
  return { kind: "text", target: "runtime", source: "plain-text", text };
}

export function getTerminalMessageTimestamp(
  message: TerminalLogMessage
): string | undefined {
  if (message.kind === "launcher-event") {
    return message.event.timestamp;
  }
  if (message.kind === "studio-event") {
    return message.event.recorded_at;
  }
  return undefined;
}

export function getTerminalMessageSource(message: TerminalLogMessage): string {
  if (message.kind === "launcher-event") {
    return message.event.source_kind;
  }
  if (message.kind === "studio-event") {
    return message.event.source;
  }
  return message.source;
}

export function getTerminalMessageTarget(message: TerminalLogMessage): TerminalLogTarget {
  return message.target;
}

export function terminalMessageText(message: TerminalLogMessage): string {
  if (message.kind === "text") {
    return message.text;
  }
  if (message.kind === "studio-event") {
    return message.event.message;
  }
  return message.event.line;
}

function compareTerminalMessages(a: TerminalLogMessage, b: TerminalLogMessage): number {
  const aValue = getTerminalMessageTimestamp(a);
  const bValue = getTerminalMessageTimestamp(b);
  if (!aValue && !bValue) {
    return 0;
  }
  if (!aValue) {
    return -1;
  }
  if (!bValue) {
    return 1;
  }
  return aValue.localeCompare(bValue);
}

export function sortTerminalMessages(messages: TerminalLogMessage[]): TerminalLogMessage[] {
  return [...messages].sort(compareTerminalMessages);
}

class TerminalLogServiceImpl implements TerminalLogService {
  private messages: TerminalLogMessage[] = [];
  private subscribers = new Set<TerminalLogSubscriber>();
  private pendingMessages: TerminalLogMessage[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private ws: WebSocket | null = null;
  private connectGeneration = 0;
  private connectRequest: Promise<void> | null = null;
  private snapshotRequest: Promise<void> | null = null;
  private reconnectTask = createPollingTask(
    () => {
      if (this.ws || !HAS_WEBSOCKET) {
        return;
      }
      console.log("[terminal] Attempting reconnect...");
      this.connect();
    },
    { intervalMs: RECONNECT_MIN_DELAY_MS, runImmediately: false }
  );
  private diagnosticsUnsubscribe: (() => void) | null = null;
  private clearOnRun = readBoolean(STORAGE_KEYS.clearOnRun, true);
  private shuttingDown = false;
  private initialLoadRequest: Promise<void> | null = null;
  private totalReceived = 0;
  private droppedCount = 0;

  constructor() {
    if (HAS_WEBSOCKET && !IS_TEST_ENV) {
      this.connect();
    } else if (!HAS_WEBSOCKET) {
      console.warn("[terminal] WebSocket unavailable in this environment");
    }
    launcherEvents.addEventListener("run-requested", this.handleRunRequested);
    launcherService.onProjectChanged(() => {
      this.reconnect();
    });
    this.diagnosticsUnsubscribe =
      getDiagnosticsBridge()?.onLogEvent?.((record) => {
        if (record.target === "studio") {
          this.pushMessage({
            kind: "studio-event",
            target: "studio",
            event: record,
          });
        }
      }) ?? null;
    if (typeof window !== "undefined") {
      window.addEventListener("robotick:app-quitting", this.handleAppQuitting);
    }
  }

  subscribe(listener: TerminalLogSubscriber) {
    this.subscribers.add(listener);
    listener();
    if (this.messages.length === 0) {
      void this.loadInitialMessages();
    }
    return () => {
      this.subscribers.delete(listener);
    };
  }

  getMessages() {
    return this.messages;
  }

  getStats(): TerminalLogStats {
    return {
      totalReceived: this.totalReceived,
      bufferedCount: this.messages.length,
      droppedCount: this.droppedCount,
      flushIntervalMs: FLUSH_INTERVAL_MS,
    };
  }

  clearMessages() {
    if (this.messages.length === 0) return;
    this.messages = [];
    this.pendingMessages = [];
    this.totalReceived = 0;
    this.droppedCount = 0;
    this.notify();
  }

  getClearOnRun() {
    return this.clearOnRun;
  }

  setClearOnRun(enabled: boolean) {
    if (this.clearOnRun === enabled) return;
    this.clearOnRun = enabled;
    writeBoolean(STORAGE_KEYS.clearOnRun, enabled);
    this.notify();
  }

  private handleRunRequested = () => {
    if (this.getClearOnRun()) {
      this.clearMessages();
      void launcherService
        .requestLauncherLogClear()
        .catch((error) => {
          console.warn("[terminal] Failed to clear hub log cursors:", error);
        })
        .finally(() => {
          this.reconnect();
        });
      return;
    }
    this.reconnect();
  };

  private reconnect() {
    this.connectGeneration += 1;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore reconnect close failures
      }
      this.ws = null;
    }
    this.reconnectTask.stop();
    this.connect();
  }

  private async loadSnapshot(options?: { replace?: boolean }) {
    if (this.snapshotRequest) {
      return this.snapshotRequest;
    }
    const replace = options?.replace ?? false;
    this.snapshotRequest = (async () => {
      try {
        const snapshot = await launcherService.fetchLauncherLogSnapshot(
          SNAPSHOT_TAIL_LINES
        );
        if (!snapshot) {
          return;
        }
        const messages = snapshot.models.flatMap((model) =>
          (model.events ?? []).map((event) => ({
            kind: "launcher-event" as const,
            target: "runtime" as const,
            event,
          }))
        );
        this.mergeMessages(messages, { replace });
      } catch (error) {
        console.warn("[terminal] Failed to load log snapshot:", error);
      } finally {
        this.snapshotRequest = null;
      }
    })();
    return this.snapshotRequest;
  }

  private async loadStudioSnapshot(options?: { replace?: boolean }) {
    try {
      const records =
        (await getDiagnosticsBridge()?.getLogSnapshot?.({
          tail: STUDIO_SNAPSHOT_TAIL_LINES,
          target: "studio",
        })) ?? [];
      const messages = records.map((record) => ({
        kind: "studio-event" as const,
        target: "studio" as const,
        event: record,
      }));
      this.mergeMessages(messages, { replace: options?.replace ?? false });
    } catch (error) {
      console.warn("[terminal] Failed to load Studio diagnostics log snapshot:", error);
    }
  }

  private async loadInitialMessages() {
    if (this.initialLoadRequest) {
      return this.initialLoadRequest;
    }
    this.initialLoadRequest = (async () => {
      await Promise.all([
        this.loadSnapshot({ replace: true }),
        this.loadStudioSnapshot({ replace: false }),
      ]);
    })().finally(() => {
      this.initialLoadRequest = null;
    });
    return this.initialLoadRequest;
  }

  private connect() {
    if (this.shuttingDown || isAppQuitting()) {
      return;
    }
    if (!HAS_WEBSOCKET) {
      return;
    }
    if (this.ws || this.connectRequest) {
      return;
    }
    const generation = this.connectGeneration;
    this.connectRequest = (async () => {
      let ws: WebSocket;
      let socketUrl = "";

      try {
        socketUrl = await launcherService.getLauncherLogStreamUrlAsync();
        if (generation !== this.connectGeneration) {
          return;
        }
        if (!socketUrl || this.shuttingDown || isAppQuitting()) {
          return;
        }
        void this.loadSnapshot({ replace: this.messages.length === 0 });
        ws = new globalThis.WebSocket(socketUrl);
        this.ws = ws;
      } catch (err) {
        if (generation === this.connectGeneration) {
          if (typeof err === "object" && err !== null) {
            recordRendererWebSocketFailure({
              source: "terminal-log-service",
              phase: "connect",
              url: socketUrl,
              message: err instanceof Error ? err.message : String(err),
            });
          }
          console.warn("[terminal] WS creation failed:", err);
          this.scheduleReconnect();
        }
        return;
      } finally {
        if (generation === this.connectGeneration) {
          this.connectRequest = null;
        }
      }

      ws.onopen = () => {
        if (this.ws !== ws) {
          return;
        }
        console.log("[terminal] Connected");
        this.reconnectTask.stop();
        this.reconnectTask.setIntervalMs(RECONNECT_MIN_DELAY_MS, {
          immediate: false,
        });
      };

      ws.onerror = (ev) => {
        if (this.ws !== ws) {
          return;
        }
        recordRendererWebSocketFailure({
          source: "terminal-log-service",
          phase: "error",
          url: ws.url,
          message: "terminal log websocket error",
        });
        console.warn("[terminal] WebSocket error:", ev);
        ws.close();
      };

      ws.onclose = (ev) => {
        if (this.ws !== ws) {
          return;
        }
        if (!this.shuttingDown && !isAppQuitting()) {
          recordRendererWebSocketFailure({
            source: "terminal-log-service",
            phase: "close",
            url: ws.url,
            message: ev.reason || "terminal log websocket closed",
            closeCode: ev.code,
          });
        }
        console.log("[terminal] Disconnected:", ev.code, ev.reason);
        this.ws = null;
        this.scheduleReconnect();
      };

      ws.onmessage = async (event) => {
        if (this.ws !== ws) {
          return;
        }
        const text = await this.normalizeEventData(event.data);
        this.pushMessage(this.parseIncomingMessage(text));
      };
    })();
  }

  private scheduleReconnect() {
    if (this.shuttingDown || isAppQuitting()) {
      return;
    }
    if (!HAS_WEBSOCKET) {
      return;
    }
    const nextDelay = Math.min(
      this.reconnectTask.getIntervalMs() * 2,
      RECONNECT_MAX_DELAY_MS
    );
    this.reconnectTask.setIntervalMs(nextDelay, { immediate: false });
    console.log(`[terminal] Reconnecting in ${nextDelay}ms...`);
    if (!this.reconnectTask.isRunning()) {
      this.reconnectTask.start({ immediate: false });
    }
  }

  private handleAppQuitting = () => {
    this.shuttingDown = true;
    this.reconnectTask.stop();
    this.diagnosticsUnsubscribe?.();
    this.diagnosticsUnsubscribe = null;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore close errors during app shutdown
      }
      this.ws = null;
    }
  };

  private pushMessage(message: TerminalLogMessage) {
    this.pendingMessages.push(message);
    this.scheduleFlush();
  }

  private mergeMessages(
    incoming: TerminalLogMessage[],
    options?: { replace?: boolean }
  ) {
    const replace = options?.replace ?? false;
    const next = sortTerminalMessages(
      replace ? [...incoming] : [...this.messages, ...incoming]
    );
    this.totalReceived = replace
      ? incoming.length
      : this.totalReceived + incoming.length;
    if (next.length > MAX_MESSAGES) {
      this.droppedCount += next.length - MAX_MESSAGES;
      this.messages = next.slice(next.length - MAX_MESSAGES);
    } else {
      this.messages = next;
    }
    this.notify();
  }

  private scheduleFlush() {
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPendingMessages();
    }, FLUSH_INTERVAL_MS);
  }

  private flushPendingMessages() {
    if (this.pendingMessages.length === 0) {
      return;
    }
    const pending = this.pendingMessages;
    this.pendingMessages = [];
    this.mergeMessages(pending);
  }

  private notify() {
    for (const listener of this.subscribers) {
      try {
        listener();
      } catch (err) {
        console.error("[terminal] Error in subscriber:", err);
      }
    }
  }

  private async normalizeEventData(data: unknown): Promise<string> {
    if (typeof data === "string") {
      return data;
    }

    if (data instanceof Blob) {
      return data.text();
    }

    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(data);
    }

    if (ArrayBuffer.isView(data)) {
      return new TextDecoder().decode(data.buffer);
    }

    return String(data);
  }

  private parseIncomingMessage(text: string): TerminalLogMessage {
    return parseTerminalLogMessage(text);
  }
}

export const terminalLogService = new TerminalLogServiceImpl();
