import { buildWebSocketUrl } from "../../launcher/internal/launcher-interface";
import { recordRendererWebSocketFailure } from "../../../services/studio-diagnostics";
import type { LayoutModel } from "./telemetry-client";

export interface TelemetryWsFrameMeta {
  engine_session_id?: string;
  frame_seq?: number;
  payload_size?: number;
}

export interface TelemetryWsFrame {
  raw: ArrayBuffer;
  sid: string;
  frameSeq: number | null;
}

export interface TelemetryWsWriteRequest {
  engine_session_id: string;
  writes: Array<{
    field_handle?: number;
    field_path?: string;
    value: unknown;
    seq?: number;
  }>;
}

export interface TelemetryWsWriteResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
}

export type TelemetryWsListener = {
  onLayout?: (layout: LayoutModel) => void;
  onFrame?: (frame: TelemetryWsFrame) => void;
  onError?: (error: unknown) => void;
};

type PendingWrite = {
  request: TelemetryWsWriteRequest;
  resolve: (result: TelemetryWsWriteResult) => void;
};

const RECONNECT_MIN_DELAY_MS = 300;
const RECONNECT_MAX_DELAY_MS = 5000;
const WRITE_STATUS_FALLBACK = 400;

class SharedTelemetryWsClient {
  private readonly listeners = new Set<TelemetryWsListener>();
  private socket: WebSocket | null = null;
  private suppressCloseFailure = false;
  private reconnectDelayMs = RECONNECT_MIN_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFrameMeta: TelemetryWsFrameMeta | null = null;
  private writeQueue: PendingWrite[] = [];
  private activeWrite: PendingWrite | null = null;

  constructor(private readonly baseUrl: string) {}

  subscribe(listener: TelemetryWsListener): () => void {
    this.listeners.add(listener);
    this.ensureConnected();

    return () => {
      this.listeners.delete(listener);
      this.maybeDisposeSocket();
    };
  }

  async sendWrite(request: TelemetryWsWriteRequest): Promise<TelemetryWsWriteResult> {
    return new Promise<TelemetryWsWriteResult>((resolve) => {
      this.writeQueue.push({ request, resolve });
      this.ensureConnected();
      this.flushWriteQueue();
    });
  }

  close() {
    this.clearReconnectTimer();
    this.pendingFrameMeta = null;
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      this.suppressCloseFailure = true;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Ignore close errors during shutdown.
      }
    }

    const failedWrite = this.consumeActiveWriteAsNetworkError();
    if (failedWrite) {
      failedWrite.resolve({
        ok: false,
        status: 0,
        body: { error: "network_error", message: "telemetry websocket closed" },
      });
    }

    while (this.writeQueue.length > 0) {
      const queued = this.writeQueue.shift();
      if (!queued) continue;
      queued.resolve({
        ok: false,
        status: 0,
        body: { error: "network_error", message: "telemetry websocket closed" },
      });
    }
  }

  hasSubscribers(): boolean {
    return this.listeners.size > 0;
  }

  private ensureConnected() {
    if (typeof globalThis.WebSocket === "undefined") {
      this.emitError(new Error("WebSocket unavailable in this environment"));
      this.failAllWritesAsNetworkError("websocket_unavailable");
      return;
    }

    if (this.socket) {
      const state = this.socket.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
        return;
      }
    }

    this.clearReconnectTimer();
    const socketUrl = buildWebSocketUrl(this.baseUrl, "/api/telemetry/ws");
    let ws: WebSocket;

    try {
      ws = new globalThis.WebSocket(socketUrl);
    } catch (error) {
      recordRendererWebSocketFailure({
        source: "telemetry-ws-client",
        phase: "connect",
        url: socketUrl,
        message: error instanceof Error ? error.message : String(error),
      });
      this.emitError(error);
      this.scheduleReconnect();
      return;
    }

    ws.binaryType = "arraybuffer";
    this.socket = ws;

    ws.onopen = () => {
      this.suppressCloseFailure = false;
      this.reconnectDelayMs = RECONNECT_MIN_DELAY_MS;
      this.flushWriteQueue();
    };

    ws.onmessage = (event) => {
      void this.handleMessage(event.data);
    };

    ws.onerror = (event) => {
      recordRendererWebSocketFailure({
        source: "telemetry-ws-client",
        phase: "error",
        url: socketUrl,
        message: "telemetry websocket error",
      });
      this.emitError(event);
    };

    ws.onclose = () => {
      if (this.socket === ws) {
        this.socket = null;
      }
      this.pendingFrameMeta = null;
      if (!this.suppressCloseFailure) {
        recordRendererWebSocketFailure({
          source: "telemetry-ws-client",
          phase: "close",
          url: socketUrl,
          message: "telemetry websocket disconnected",
        });
      }
      this.suppressCloseFailure = false;
      const active = this.consumeActiveWriteAsNetworkError();
      if (active) {
        active.resolve({
          ok: false,
          status: 0,
          body: {
            error: "network_error",
            message: "telemetry websocket disconnected",
          },
        });
      }
      this.scheduleReconnect();
    };
  }

  private maybeDisposeSocket() {
    const hasPendingWrites = this.activeWrite !== null || this.writeQueue.length > 0;
    if (this.listeners.size > 0 || hasPendingWrites) {
      return;
    }
    this.close();
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private scheduleReconnect() {
    const wantsReconnect = this.listeners.size > 0 || this.activeWrite !== null || this.writeQueue.length > 0;
    if (!wantsReconnect || this.reconnectTimer) {
      return;
    }

    const delay = this.reconnectDelayMs;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay);
    this.reconnectDelayMs = Math.min(
      RECONNECT_MAX_DELAY_MS,
      Math.max(RECONNECT_MIN_DELAY_MS, this.reconnectDelayMs * 2),
    );
  }

  private async handleMessage(data: unknown) {
    if (typeof data === "string") {
      this.handleTextMessage(data);
      return;
    }

    const binary = await this.normalizeBinaryPayload(data);
    if (!binary) {
      return;
    }

    const meta = this.pendingFrameMeta;
    this.pendingFrameMeta = null;
    if (!meta) {
      return;
    }

    const sid = typeof meta.engine_session_id === "string" ? meta.engine_session_id : "";
    const frameSeq = Number.isFinite(meta.frame_seq) ? Number(meta.frame_seq) : null;
    this.emitFrame({ raw: binary, sid, frameSeq });
  }

  private handleTextMessage(text: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.emitError(new Error("Invalid telemetry websocket JSON payload"));
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      return;
    }

    if (isLayoutModel(parsed)) {
      this.emitLayout(parsed);
      return;
    }

    const obj = parsed as Record<string, unknown>;
    const type = typeof obj.type === "string" ? obj.type : "";

    if (type === "layout" && isLayoutModel(obj.layout)) {
      this.emitLayout(obj.layout as LayoutModel);
      return;
    }

    if (type === "frame") {
      this.pendingFrameMeta = {
        engine_session_id:
          typeof obj.engine_session_id === "string" ? obj.engine_session_id : undefined,
        frame_seq:
          typeof obj.frame_seq === "number" && Number.isFinite(obj.frame_seq)
            ? obj.frame_seq
            : undefined,
        payload_size:
          typeof obj.payload_size === "number" && Number.isFinite(obj.payload_size)
            ? obj.payload_size
            : undefined,
      };
      return;
    }

    if (type === "heartbeat" || type === "hello") {
      return;
    }

    const isWriteResponse =
      this.activeWrite !== null &&
      (
        typeof obj.status === "string" ||
        Array.isArray(obj.writes) ||
        typeof obj.error === "string"
      );

    if (isWriteResponse) {
      const active = this.activeWrite;
      this.activeWrite = null;
      if (active) {
        const isError = typeof obj.error === "string";
        const statusRaw = obj.status_code;
        const status =
          typeof statusRaw === "number" && Number.isFinite(statusRaw)
            ? Math.floor(statusRaw)
            : isError
              ? WRITE_STATUS_FALLBACK
              : 200;
        active.resolve({
          ok: !isError,
          status,
          body: obj,
        });
      }
      this.flushWriteQueue();
      return;
    }

    if (type === "error" || typeof obj.error === "string") {
      this.emitError(new Error(String(obj.error ?? "telemetry_ws_error")));
    }
  }

  private flushWriteQueue() {
    if (this.activeWrite || this.writeQueue.length === 0) {
      return;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.ensureConnected();
      return;
    }

    const next = this.writeQueue.shift();
    if (!next) {
      return;
    }

    this.activeWrite = next;
    const payload = JSON.stringify({
      type: "write",
      engine_session_id: next.request.engine_session_id,
      writes: next.request.writes,
    });

    try {
      this.socket.send(payload);
    } catch (error) {
      const failed = this.consumeActiveWriteAsNetworkError();
      if (failed) {
        failed.resolve({
          ok: false,
          status: 0,
          body: {
            error: "network_error",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      this.scheduleReconnect();
    }
  }

  private consumeActiveWriteAsNetworkError(): PendingWrite | null {
    if (!this.activeWrite) {
      return null;
    }
    const active = this.activeWrite;
    this.activeWrite = null;
    return active;
  }

  private failAllWritesAsNetworkError(message: string) {
    const active = this.consumeActiveWriteAsNetworkError();
    if (active) {
      active.resolve({
        ok: false,
        status: 0,
        body: { error: "network_error", message },
      });
    }

    while (this.writeQueue.length > 0) {
      const queued = this.writeQueue.shift();
      if (!queued) continue;
      queued.resolve({
        ok: false,
        status: 0,
        body: { error: "network_error", message },
      });
    }
  }

  private async normalizeBinaryPayload(data: unknown): Promise<ArrayBuffer | null> {
    if (data instanceof ArrayBuffer) {
      return data;
    }

    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(
        data.buffer,
        data.byteOffset,
        data.byteLength,
      ).slice().buffer;
    }

    if (data instanceof Blob) {
      try {
        return await data.arrayBuffer();
      } catch {
        return null;
      }
    }

    return null;
  }

  private emitLayout(layout: LayoutModel) {
    this.listeners.forEach((listener) => {
      listener.onLayout?.(layout);
    });
  }

  private emitFrame(frame: TelemetryWsFrame) {
    this.listeners.forEach((listener) => {
      listener.onFrame?.(frame);
    });
  }

  private emitError(error: unknown) {
    this.listeners.forEach((listener) => {
      listener.onError?.(error);
    });
  }
}

const sharedClients = new Map<string, SharedTelemetryWsClient>();

function getOrCreateClient(baseUrl: string): SharedTelemetryWsClient {
  const key = baseUrl.trim();
  let client = sharedClients.get(key);
  if (!client) {
    client = new SharedTelemetryWsClient(key);
    sharedClients.set(key, client);
  }
  return client;
}

export function subscribeTelemetryWs(
  baseUrl: string,
  listener: TelemetryWsListener,
): () => void {
  if (!baseUrl.trim()) {
    return () => {};
  }

  const key = baseUrl.trim();
  const client = getOrCreateClient(key);
  const unsubscribe = client.subscribe(listener);

  return () => {
    unsubscribe();
    if (!client.hasSubscribers()) {
      client.close();
      sharedClients.delete(key);
    }
  };
}

export async function sendTelemetryWriteWs(
  baseUrl: string,
  request: TelemetryWsWriteRequest,
): Promise<TelemetryWsWriteResult> {
  const key = baseUrl.trim();
  if (!key) {
    return {
      ok: false,
      status: 0,
      body: { error: "invalid_base_url" },
    };
  }

  const client = getOrCreateClient(key);
  const result = await client.sendWrite(request);

  if (!client.hasSubscribers()) {
    client.close();
    sharedClients.delete(key);
  }

  return result;
}

export function resetTelemetryWsClients() {
  sharedClients.forEach((client) => client.close());
  sharedClients.clear();
}

function isLayoutModel(value: unknown): value is LayoutModel {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { types?: unknown; workloads?: unknown };
  return Array.isArray(candidate.types) && Array.isArray(candidate.workloads);
}
