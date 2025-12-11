import { readStorageValue, setStorageValue } from "../../../services/storage";
import { launcherEvents } from "./LauncherContext";
import { getLauncherLogStreamUrl } from "./launcher-interface";
import { launcherService } from "./LauncherService";

type TerminalLogSubscriber = () => void;

export interface TerminalLogService {
  subscribe(listener: TerminalLogSubscriber): () => void;
  getMessages(): string[];
  clearMessages(): void;
  getFilter(): string;
  setFilter(value: string): void;
  getWrapText(): boolean;
  setWrapText(enabled: boolean): void;
  getAutoScroll(): boolean;
  setAutoScroll(enabled: boolean): void;
  getClearOnRun(): boolean;
  setClearOnRun(enabled: boolean): void;
}

const MAX_MESSAGES = 5000;
const STORAGE_KEYS = {
  filter: "robotick-studio.terminal.filter",
  wrapText: "robotick-studio.terminal.wrapText",
  autoScroll: "robotick-studio.terminal.autoScroll",
  clearOnRun: "robotick-studio.terminal.clearOnRun",
} as const;

const HAS_WEBSOCKET = typeof globalThis.WebSocket !== "undefined";

function readString(key: string, fallback: string): string {
  return readStorageValue(key) ?? fallback;
}

function writeString(key: string, value: string) {
  setStorageValue(key, value);
}

function readBoolean(key: string, fallback: boolean): boolean {
  const raw = readStorageValue(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function writeBoolean(key: string, value: boolean) {
  setStorageValue(key, value ? "true" : "false");
}

class TerminalLogServiceImpl implements TerminalLogService {
  private messages: string[] = [];
  private subscribers = new Set<TerminalLogSubscriber>();
  private ws: WebSocket | null = null;
  private retryTimer: number | null = null;
  private retryDelay = 1000;

  private filter = readString(STORAGE_KEYS.filter, "");
  private wrapText = readBoolean(STORAGE_KEYS.wrapText, true);
  private autoScroll = readBoolean(STORAGE_KEYS.autoScroll, true);
  private clearOnRun = readBoolean(STORAGE_KEYS.clearOnRun, true);

  constructor() {
    if (HAS_WEBSOCKET) {
      this.connect();
    } else {
      console.warn("[terminal] WebSocket unavailable in this environment");
    }
    launcherEvents.addEventListener("run-requested", this.handleRunRequested);
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

  getFilter() {
    return this.filter;
  }

  setFilter(value: string) {
    if (this.filter === value) return;
    this.filter = value;
    writeString(STORAGE_KEYS.filter, value);
    this.notify();
  }

  getWrapText() {
    return this.wrapText;
  }

  setWrapText(enabled: boolean) {
    if (this.wrapText === enabled) return;
    this.wrapText = enabled;
    writeBoolean(STORAGE_KEYS.wrapText, enabled);
    this.notify();
  }

  getAutoScroll() {
    return this.autoScroll;
  }

  setAutoScroll(enabled: boolean) {
    if (this.autoScroll === enabled) return;
    this.autoScroll = enabled;
    writeBoolean(STORAGE_KEYS.autoScroll, enabled);
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
    }
  };

  private connect() {
    let ws: WebSocket;

    try {
      const socketUrl = launcherService.getLauncherLogStreamUrl();
      ws = new globalThis.WebSocket(socketUrl);
      this.ws = ws;
    } catch (err) {
      console.warn("[terminal] WS creation failed:", err);
      this.scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log("[terminal] Connected");
      this.retryDelay = 1000;
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
      this.pushMessage(text);
    };
  }

  private scheduleReconnect() {
    if (this.retryTimer !== null) return;

    const delay = this.retryDelay;
    const capped = Math.min(delay, 8000);

    console.log(`[terminal] Reconnecting in ${capped}ms...`);

    this.retryTimer = globalThis.setTimeout(() => {
      this.retryTimer = null;
      this.retryDelay = Math.min(delay * 2, 8000);
      this.connect();
    }, capped);
  }

  private pushMessage(message: string) {
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
}

export const terminalLogService = new TerminalLogServiceImpl();
