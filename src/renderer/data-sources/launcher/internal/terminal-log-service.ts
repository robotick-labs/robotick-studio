import { readStorageValue, setStorageValue } from "../../../services/storage";
import { launcherEvents } from "./LauncherContext";
import type { LauncherModelLogEvent } from "./launcher-interface";
import { launcherService } from "./LauncherService";
import { createPollingTask } from "../../../utils/polling";
import { isAppQuitting } from "../../../utils/appQuitting";

type TerminalLogSubscriber = () => void;

export type TerminalLogMessage =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "launcher-event";
      event: LauncherModelLogEvent;
    };

export interface TerminalLogService {
  subscribe(listener: TerminalLogSubscriber): () => void;
  getMessages(): TerminalLogMessage[];
  clearMessages(): void;
  getClearOnRun(): boolean;
  setClearOnRun(enabled: boolean): void;
}

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
        event: parsed as LauncherModelLogEvent,
      };
    }
  } catch {
    // Plain text streams remain supported for diagnostics and compatibility.
  }
  return { kind: "text", text };
}

class TerminalLogServiceImpl implements TerminalLogService {
  private messages: TerminalLogMessage[] = [];
  private subscribers = new Set<TerminalLogSubscriber>();
  private ws: WebSocket | null = null;
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
  private clearOnRun = readBoolean(STORAGE_KEYS.clearOnRun, true);
  private shuttingDown = false;

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
    if (typeof window !== "undefined") {
      window.addEventListener("robotick:app-quitting", this.handleAppQuitting);
    }
  }

  subscribe(listener: TerminalLogSubscriber) {
    this.subscribers.add(listener);
    listener();
    return () => {
      this.subscribers.delete(listener);
    };
  }

  getMessages() {
    return this.messages;
  }

  clearMessages() {
    if (this.messages.length === 0) return;
    this.messages = [];
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
      void launcherService.requestLauncherLogClear().catch((error) => {
        console.warn("[terminal] Failed to clear hub log cursors:", error);
      });
    }
  };

  private reconnect() {
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

  private async loadSnapshot() {
    try {
      const snapshot = await launcherService.fetchLauncherLogSnapshot(
        SNAPSHOT_TAIL_LINES
      );
      if (!snapshot) {
        return;
      }
      const events = snapshot.models.flatMap((model) => model.events ?? []);
      for (const event of events) {
        this.pushMessage({ kind: "launcher-event", event });
      }
    } catch (error) {
      console.warn("[terminal] Failed to load log snapshot:", error);
    }
  }

  private connect() {
    if (this.shuttingDown || isAppQuitting()) {
      return;
    }
    if (!HAS_WEBSOCKET) {
      return;
    }
    if (this.ws) {
      return;
    }
    let ws: WebSocket;

    try {
      const socketUrl = launcherService.getLauncherLogStreamUrl();
      if (!socketUrl) {
        return;
      }
      void this.loadSnapshot();
      ws = new globalThis.WebSocket(socketUrl);
      this.ws = ws;
    } catch (err) {
      console.warn("[terminal] WS creation failed:", err);
      this.scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log("[terminal] Connected");
      this.reconnectTask.stop();
      this.reconnectTask.setIntervalMs(RECONNECT_MIN_DELAY_MS, {
        immediate: false,
      });
    };

    ws.onerror = (ev) => {
      console.warn("[terminal] WebSocket error:", ev);
      ws.close();
    };

    ws.onclose = (ev) => {
      console.log("[terminal] Disconnected:", ev.code, ev.reason);
      this.ws = null;
      this.scheduleReconnect();
    };

    ws.onmessage = async (event) => {
      const text = await this.normalizeEventData(event.data);
      this.pushMessage(this.parseIncomingMessage(text));
    };
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
    const next = [...this.messages, message];
    if (next.length > MAX_MESSAGES) {
      this.messages = next.slice(next.length - MAX_MESSAGES);
    } else {
      this.messages = next;
    }
    this.notify();
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
