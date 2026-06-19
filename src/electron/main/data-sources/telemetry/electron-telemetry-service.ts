// Copyright Robotick contributors
// SPDX-License-Identifier: Apache-2.0

import {
  createTelemetryModel,
  type ITelemetryField,
  type ITelemetryModel,
  type ITelemetryStruct,
  type ITelemetryWorkload,
  type LayoutModel,
} from "../../../common/telemetry/telemetry-decoder";
import type {
  ElectronTelemetryBaseUrlDiagnostics,
  ElectronTelemetryLayoutFrame,
  ElectronTelemetryRawFrame,
  ElectronTelemetrySharedDiagnostics,
} from "../../../common/telemetry-bridge-contract";

export type ElectronTelemetryModelInfo = {
  model_id: string;
  display_name: string;
  model_path: string;
  engine_model_id: string | null;
  telemetry_base_url: string;
  telemetry_port: number;
  telemetry_push_rate_hz: number;
  health: "unknown" | "ready" | "error";
  stale: boolean;
  latest_frame_seq: number | null;
  latest_engine_session_id: string | null;
  latest_raw_at: string | null;
  latest_error: string | null;
};

export type ElectronTelemetryModelsResponse = {
  resource_type: "robotick_studio_telemetry_models";
  project_path: string | null;
  models: ElectronTelemetryModelInfo[];
};

export type ElectronTelemetryLayoutResponse = {
  resource_type: "robotick_studio_telemetry_model_layout";
  model: ElectronTelemetryModelInfo;
  layout: LayoutModel;
  loaded_at: string;
};

export type ElectronTelemetryRawBufferResponse = {
  resource_type: "robotick_studio_telemetry_model_raw_buffer";
  model: ElectronTelemetryModelInfo;
  body: Buffer;
  byte_length: number;
  frame_seq: number | null;
  engine_session_id: string | null;
  loaded_at: string;
};

export type ElectronTelemetrySnapshotResponse = {
  resource_type: "robotick_studio_telemetry_model_snapshot";
  generated_at: string;
  model: ElectronTelemetryModelInfo;
  source: {
    frame_seq: number | null;
    engine_session_id: string | null;
    raw_byte_length: number;
    layout_loaded_at: string;
    raw_loaded_at: string;
  };
  layout: LayoutModel;
  engine: SerializedTelemetryStruct | null;
  process_threads: ITelemetryModel["process_threads"];
  workloads: SerializedTelemetryWorkload[];
};

export type ElectronTelemetryService = {
  listModels(): Promise<ElectronTelemetryModelsResponse>;
  getLayout(modelId: string): Promise<ElectronTelemetryLayoutResponse>;
  getRawBuffer(modelId: string): Promise<ElectronTelemetryRawBufferResponse>;
  getSnapshot(modelId: string): Promise<ElectronTelemetrySnapshotResponse>;
  ensureLayoutForBaseUrl(baseUrl: string): Promise<ElectronTelemetryLayoutFrame | null>;
  refreshLayoutForBaseUrl(baseUrl: string): Promise<ElectronTelemetryLayoutFrame | null>;
  subscribeBaseUrl(
    baseUrl: string,
    listener: ElectronTelemetryStreamListener,
  ): () => void;
  getBaseUrlDiagnostics(baseUrl: string): ElectronTelemetryBaseUrlDiagnostics;
  getSharedDiagnostics(): ElectronTelemetrySharedDiagnostics;
  getHealthForBaseUrl(baseUrl: string): Promise<ElectronTelemetryHealthResult>;
  getPushStatsForBaseUrl(baseUrl: string): Promise<ElectronTelemetryPushStatsResult>;
  setWorkloadInputFieldsDataForBaseUrl(
    baseUrl: string,
    request: ElectronTelemetryWriteRequest,
  ): Promise<ElectronTelemetryWriteResult>;
  setWorkloadInputConnectionStateForBaseUrl(
    baseUrl: string,
    request: ElectronTelemetryConnectionStateRequest,
  ): Promise<ElectronTelemetryWriteResult>;
  reset(): void;
};

export type ElectronTelemetryServiceDependencies = {
  getSelectedProjectPath: () => string | null | undefined;
  getHubEndpoint: () => string | null | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
  webSocketFactory?: (url: string) => ElectronTelemetryWebSocket;
};

export type ElectronTelemetryStreamEvent =
  | {
      type: "layout";
      payload: ElectronTelemetryLayoutFrame;
    }
  | {
      type: "frame";
      payload: ElectronTelemetryRawFrame;
    }
  | {
      type: "error";
      message: string;
    };

export type ElectronTelemetryStreamListener = (
  event: ElectronTelemetryStreamEvent,
) => void;

export type ElectronTelemetryHealthResult = {
  ok: boolean;
  status: number;
  statusText: string;
  body: Record<string, unknown> | null;
};

export type ElectronTelemetryPushStatsResult = {
  ok: boolean;
  status: number;
  statusText?: string;
  body: Record<string, unknown> | null;
};

export type ElectronTelemetryWriteRequest = {
  engine_session_id: string;
  writes: Array<{
    field_handle?: number;
    field_path?: string;
    value: unknown;
    seq?: number;
  }>;
};

export type ElectronTelemetryConnectionStateRequest = {
  engine_session_id: string;
  updates: Array<{
    field_handle?: number;
    field_path?: string;
    enabled: boolean;
  }>;
};

export type ElectronTelemetryWriteResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
};

type ElectronTelemetryWebSocket = {
  binaryType: string;
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  close: () => void;
};

export class ElectronTelemetryServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 500) {
    super(message);
    this.name = "ElectronTelemetryServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

type SerializedTelemetryField = {
  name: string;
  type: string;
  path: string;
  offset: number;
  element_count: number;
  value: unknown;
  fields?: SerializedTelemetryField[];
};

type SerializedTelemetryStruct = {
  type: string;
  offset: number;
  fields: Record<string, SerializedTelemetryField>;
};

type SerializedTelemetryWorkload = {
  name: string;
  display_name?: string;
  type: string;
  memory: {
    total_bytes: number;
    static_bytes: number;
    dynamic_bytes: number;
  };
  stats: SerializedTelemetryStruct | null;
  config: SerializedTelemetryStruct | null;
  inputs: SerializedTelemetryStruct | null;
  outputs: SerializedTelemetryStruct | null;
};

type ModelDescriptor = {
  model_id: string;
  display_name: string;
  model_path: string;
  engine_model_id: string | null;
  telemetry_base_url: string;
  telemetry_port: number;
  telemetry_push_rate_hz: number;
  data: unknown;
};

type LayoutCacheEntry = {
  layout: LayoutModel;
  loadedAt: string;
};

type RawCacheEntry = {
  body: Buffer;
  frameSeq: number | null;
  engineSessionId: string | null;
  loadedAt: string;
};

type BaseUrlTelemetryEntry = {
  baseUrl: string;
  listeners: Set<ElectronTelemetryStreamListener>;
  client: ElectronTelemetryWsClient | null;
  layout: LayoutCacheEntry | null;
  raw: ElectronTelemetryRawFrame | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};

type PendingFrameMeta = {
  engine_session_id?: string;
  frame_seq?: number;
};

const DEFAULT_TELEMETRY_PORT = 7090;
const DEFAULT_TELEMETRY_PUSH_RATE_HZ = 20;
const RECONNECT_MIN_DELAY_MS = 300;
const RECONNECT_MAX_DELAY_MS = 5000;
const MAX_PENDING_FRAME_META = 64;
const WS_OPEN = 1;
const WS_CONNECTING = 0;

function buildUrl(
  baseUrl: string,
  pathname: string,
  params?: Record<string, string>,
): string {
  const url = new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function buildWebSocketUrl(baseUrl: string, pathname: string): string {
  const url = new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function normalizePort(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_TELEMETRY_PORT;
}

function normalizeTelemetryPushRateHz(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_TELEMETRY_PUSH_RATE_HZ;
}

function buildModelShortName(modelPath: string): string {
  return (
    modelPath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.model\.ya?ml$/i, "")
      .replace(/\.ya?ml$/i, "") || modelPath
  );
}

function modelDisplayName(modelPath: string, data: unknown): string {
  const modelName = (data as { name?: unknown } | null)?.name;
  if (typeof modelName === "string" && modelName.trim()) {
    return modelName.trim();
  }
  return buildModelShortName(modelPath);
}

function buildTelemetryBaseUrl(data: unknown, telemetryPort: number): string {
  const runtime = (data as { runtime?: { preferred_host?: unknown } } | null)?.runtime;
  const preferredHost =
    typeof runtime?.preferred_host === "string" && runtime.preferred_host.trim()
      ? runtime.preferred_host.trim()
      : "localhost";
  return `http://${preferredHost}:${telemetryPort}`;
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new ElectronTelemetryServiceError(
      "telemetry_network_failure",
      `Fetch failed for ${url}: HTTP ${response.status}`,
      502,
    );
  }
  return (await response.json()) as T;
}

function numberHeader(response: Response, headerName: string): number | null {
  const value = response.headers.get(headerName);
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringHeader(response: Response, headerName: string): string | null {
  const value = response.headers.get(headerName);
  return value && value.trim() ? value.trim() : null;
}

function arrayBufferFromBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  return copy;
}

function normalizeArrayBuffer(data: unknown): Promise<ArrayBuffer | null> {
  if (data instanceof ArrayBuffer) {
    return Promise.resolve(data);
  }
  if (Buffer.isBuffer(data)) {
    return Promise.resolve(arrayBufferFromBuffer(data));
  }
  if (ArrayBuffer.isView(data)) {
    return Promise.resolve(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer,
    );
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data.arrayBuffer().catch(() => null);
  }
  return Promise.resolve(null);
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    const preview = Array.from(value.slice(0, 32))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return {
      value_type: "uint8_array",
      byte_length: value.byteLength,
      preview_hex: preview,
      preview_truncated: value.byteLength > 32,
    };
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value && typeof value === "object") {
    const serialized: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      serialized[key] = serializeValue(entryValue);
    }
    return serialized;
  }
  return value;
}

function serializeField(field: ITelemetryField): SerializedTelemetryField {
  const serialized: SerializedTelemetryField = {
    name: field.name,
    type: field.type,
    path: field.path,
    offset: field.offset,
    element_count: field.elementCount,
    value: serializeValue(field.getValue()),
  };
  if (field.fields && field.fields.length > 0) {
    serialized.fields = field.fields.map(serializeField);
  }
  return serialized;
}

function serializeStruct(
  struct: ITelemetryStruct | undefined,
): SerializedTelemetryStruct | null {
  if (!struct) {
    return null;
  }
  const fields: Record<string, SerializedTelemetryField> = {};
  for (const field of struct.fields) {
    fields[field.name] = serializeField(field);
  }
  return {
    type: struct.typeName,
    offset: struct.offset,
    fields,
  };
}

function serializeWorkload(workload: ITelemetryWorkload): SerializedTelemetryWorkload {
  return {
    name: workload.name,
    display_name: workload.displayName,
    type: workload.type,
    memory: {
      total_bytes: workload.workloadsBufferTotalBytes,
      static_bytes: workload.workloadsBufferStaticBytes,
      dynamic_bytes: workload.workloadsBufferDynamicBytes,
    },
    stats: serializeStruct(workload.stats),
    config: serializeStruct(workload.config),
    inputs: serializeStruct(workload.inputs),
    outputs: serializeStruct(workload.outputs),
  };
}

function toPublicModelInfo(
  descriptor: ModelDescriptor,
  layout: LayoutCacheEntry | undefined,
  raw: RawCacheEntry | undefined,
  latestError: string | null,
): ElectronTelemetryModelInfo {
  return {
    model_id: descriptor.model_id,
    display_name: descriptor.display_name,
    model_path: descriptor.model_path,
    engine_model_id: descriptor.engine_model_id,
    telemetry_base_url: descriptor.telemetry_base_url,
    telemetry_port: descriptor.telemetry_port,
    telemetry_push_rate_hz: descriptor.telemetry_push_rate_hz,
    health: latestError ? "error" : layout || raw ? "ready" : "unknown",
    stale: false,
    latest_frame_seq: raw?.frameSeq ?? null,
    latest_engine_session_id: raw?.engineSessionId ?? layout?.layout.engine_session_id ?? null,
    latest_raw_at: raw?.loadedAt ?? null,
    latest_error: latestError,
  };
}

class ElectronTelemetryWsClient {
  private socket: ElectronTelemetryWebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = RECONNECT_MIN_DELAY_MS;
  private pendingFrameMetaQueue: PendingFrameMeta[] = [];
  private suppressCloseFailure = false;

  constructor(
    private readonly baseUrl: string,
    private readonly webSocketFactory: (url: string) => ElectronTelemetryWebSocket,
    private readonly onLayout: (layout: LayoutModel) => void,
    private readonly onFrame: (frame: ElectronTelemetryRawFrame) => void,
    private readonly onError: (error: unknown) => void,
    private readonly now: () => Date,
  ) {}

  get readyState(): number | null {
    return this.socket?.readyState ?? null;
  }

  connect() {
    if (this.socket) {
      const state = this.socket.readyState;
      if (state === WS_OPEN || state === WS_CONNECTING) {
        return;
      }
    }

    this.clearReconnectTimer();
    const socketUrl = buildWebSocketUrl(this.baseUrl, "/api/telemetry/ws");
    let socket: ElectronTelemetryWebSocket;
    try {
      socket = this.webSocketFactory(socketUrl);
    } catch (error) {
      this.onError(error);
      this.scheduleReconnect();
      return;
    }

    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      this.suppressCloseFailure = false;
      this.reconnectDelayMs = RECONNECT_MIN_DELAY_MS;
    };
    socket.onmessage = (event) => {
      void this.handleMessage(event.data);
    };
    socket.onerror = (event) => {
      this.onError(event);
    };
    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      this.pendingFrameMetaQueue = [];
      if (!this.suppressCloseFailure) {
        this.onError(new Error("telemetry websocket disconnected"));
      }
      this.suppressCloseFailure = false;
      this.scheduleReconnect();
    };
  }

  close() {
    this.clearReconnectTimer();
    this.pendingFrameMetaQueue = [];
    if (!this.socket) {
      return;
    }
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

  private clearReconnectTimer() {
    if (!this.reconnectTimer) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }
    const delay = this.reconnectDelayMs;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
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

    const binary = await normalizeArrayBuffer(data);
    if (!binary) {
      return;
    }

    const meta = this.pendingFrameMetaQueue.shift() ?? null;
    if (!meta) {
      return;
    }

    this.onFrame({
      raw: binary,
      sid: typeof meta.engine_session_id === "string" ? meta.engine_session_id : "",
      frameSeq: Number.isFinite(meta.frame_seq) ? Number(meta.frame_seq) : null,
      timestamp: this.now().getTime(),
    });
  }

  private handleTextMessage(text: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      this.onError(error);
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      return;
    }
    if (isLayoutModel(parsed)) {
      this.onLayout(parsed);
      return;
    }

    const obj = parsed as Record<string, unknown>;
    if (obj.type === "layout" && isLayoutModel(obj.layout)) {
      this.onLayout(obj.layout);
      return;
    }
    if (obj.type === "frame") {
      this.pendingFrameMetaQueue.push({
        engine_session_id:
          typeof obj.engine_session_id === "string" ? obj.engine_session_id : undefined,
        frame_seq:
          typeof obj.frame_seq === "number" && Number.isFinite(obj.frame_seq)
            ? obj.frame_seq
            : undefined,
      });
      if (this.pendingFrameMetaQueue.length > MAX_PENDING_FRAME_META) {
        this.pendingFrameMetaQueue.shift();
      }
      return;
    }
    if (obj.type === "heartbeat" || obj.type === "hello") {
      return;
    }
    if (obj.type === "error" || typeof obj.error === "string") {
      this.onError(new Error(String(obj.error ?? "telemetry_ws_error")));
    }
  }
}

function isLayoutModel(value: unknown): value is LayoutModel {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { types?: unknown; workloads?: unknown };
  return Array.isArray(candidate.types) && Array.isArray(candidate.workloads);
}

export function createElectronTelemetryService(
  dependencies: ElectronTelemetryServiceDependencies,
): ElectronTelemetryService {
  const fetchImpl = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const webSocketFactory =
    dependencies.webSocketFactory ??
    ((url: string) => {
      if (typeof globalThis.WebSocket === "undefined") {
        throw new ElectronTelemetryServiceError(
          "websocket_unavailable",
          "WebSocket is unavailable in Electron main.",
          503,
        );
      }
      return new globalThis.WebSocket(url) as unknown as ElectronTelemetryWebSocket;
    });
  let descriptorProjectPath: string | null = null;
  let descriptorCache: ModelDescriptor[] | null = null;
  const layoutCache = new Map<string, LayoutCacheEntry>();
  const rawCache = new Map<string, RawCacheEntry>();
  const latestErrors = new Map<string, string>();
  const baseUrlEntries = new Map<string, BaseUrlTelemetryEntry>();

  async function resolveDescriptors(): Promise<ModelDescriptor[]> {
    const projectPath = dependencies.getSelectedProjectPath()?.trim() || null;
    const hubEndpoint = dependencies.getHubEndpoint()?.trim() || null;
    if (!projectPath || !hubEndpoint) {
      descriptorProjectPath = projectPath;
      descriptorCache = [];
      return [];
    }
    if (descriptorCache && descriptorProjectPath === projectPath) {
      return descriptorCache;
    }

    const modelPaths = (
      await fetchJson<string[]>(
        fetchImpl,
        buildUrl(hubEndpoint, "/query/list-project-models", {
          project_path: projectPath,
        }),
      )
    ).slice().sort();

    const descriptors = (
      await Promise.all(
        modelPaths.map(async (modelPath) => {
          const data = await fetchJson<unknown>(
            fetchImpl,
            buildUrl(hubEndpoint, "/query/get-model", {
              project_path: projectPath,
              model_path: modelPath,
            }),
          );
          const telemetry = (data as { telemetry?: Record<string, unknown> } | null)
            ?.telemetry;
          const telemetryPort = normalizePort(telemetry?.port);
          return {
            model_id: buildModelShortName(modelPath),
            display_name: modelDisplayName(modelPath, data),
            model_path: modelPath,
            engine_model_id:
              typeof (data as { id?: unknown } | null)?.id === "string"
                ? ((data as { id: string }).id.trim() || null)
                : null,
            telemetry_base_url: buildTelemetryBaseUrl(data, telemetryPort),
            telemetry_port: telemetryPort,
            telemetry_push_rate_hz: normalizeTelemetryPushRateHz(
              telemetry?.telemetry_push_rate_hz,
            ),
            data,
          } satisfies ModelDescriptor;
        }),
      )
    );

    descriptorProjectPath = projectPath;
    descriptorCache = descriptors;
    return descriptors;
  }

  async function resolveDescriptor(modelId: string): Promise<ModelDescriptor> {
    const descriptors = await resolveDescriptors();
    const descriptor = descriptors.find((candidate) => candidate.model_id === modelId);
    if (!descriptor) {
      throw new ElectronTelemetryServiceError(
        "unknown_model",
        `Unknown telemetry model: ${modelId}`,
        404,
      );
    }
    return descriptor;
  }

  async function fetchLayout(descriptor: ModelDescriptor): Promise<LayoutCacheEntry> {
    const cached = layoutCache.get(descriptor.model_id);
    if (cached) {
      return cached;
    }

    try {
      const layout = await fetchJson<LayoutModel>(
        fetchImpl,
        buildUrl(descriptor.telemetry_base_url, "/api/telemetry/workloads_buffer/layout"),
      );
      const entry = { layout, loadedAt: now().toISOString() };
      layoutCache.set(descriptor.model_id, entry);
      latestErrors.delete(descriptor.model_id);
      return entry;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      latestErrors.set(descriptor.model_id, message);
      if (error instanceof ElectronTelemetryServiceError) {
        throw error;
      }
      throw new ElectronTelemetryServiceError(
        "layout_unavailable",
        message,
        503,
      );
    }
  }

  async function fetchRaw(descriptor: ModelDescriptor): Promise<RawCacheEntry> {
    const response = await fetchImpl(
      buildUrl(descriptor.telemetry_base_url, "/api/telemetry/workloads_buffer/raw"),
    );
    if (!response.ok) {
      throw new ElectronTelemetryServiceError(
        response.status === 404 ? "raw_buffer_unavailable" : "telemetry_network_failure",
        `Raw telemetry fetch failed for ${descriptor.model_id}: HTTP ${response.status}`,
        response.status === 404 ? 404 : 502,
      );
    }
    const body = Buffer.from(await response.arrayBuffer());
    const entry = {
      body,
      frameSeq:
        numberHeader(response, "X-Robotick-Frame-Seq") ??
        numberHeader(response, "x-robotick-frame-seq"),
      engineSessionId:
        stringHeader(response, "X-Robotick-Engine-Session-Id") ??
        stringHeader(response, "x-robotick-engine-session-id"),
      loadedAt: now().toISOString(),
    };
    rawCache.set(descriptor.model_id, entry);
    latestErrors.delete(descriptor.model_id);
    return entry;
  }

  function getOrCreateBaseUrlEntry(baseUrl: string): BaseUrlTelemetryEntry {
    const key = baseUrl.trim();
    let entry = baseUrlEntries.get(key);
    if (entry) {
      return entry;
    }
    entry = {
      baseUrl: key,
      listeners: new Set(),
      client: null,
      layout: null,
      raw: null,
      lastErrorAt: null,
      lastErrorMessage: null,
    };
    baseUrlEntries.set(key, entry);
    return entry;
  }

  function layoutFrame(entry: BaseUrlTelemetryEntry): ElectronTelemetryLayoutFrame | null {
    if (!entry.layout) {
      return null;
    }
    return {
      layout: entry.layout.layout,
      latestRaw: entry.raw,
    };
  }

  function emitBaseUrlEvent(
    entry: BaseUrlTelemetryEntry,
    event: ElectronTelemetryStreamEvent,
  ) {
    for (const listener of entry.listeners) {
      listener(event);
    }
  }

  function handleBaseUrlLayout(
    entry: BaseUrlTelemetryEntry,
    layout: LayoutModel,
  ) {
    entry.layout = {
      layout,
      loadedAt: now().toISOString(),
    };
    entry.lastErrorAt = null;
    entry.lastErrorMessage = null;
    const frame = layoutFrame(entry);
    if (frame) {
      emitBaseUrlEvent(entry, { type: "layout", payload: frame });
    }
  }

  function handleBaseUrlFrame(
    entry: BaseUrlTelemetryEntry,
    frame: ElectronTelemetryRawFrame,
  ) {
    entry.raw = frame;
    entry.lastErrorAt = null;
    entry.lastErrorMessage = null;
    const layoutSid = entry.layout?.layout.engine_session_id ?? "";
    if (frame.sid && layoutSid && frame.sid !== layoutSid) {
      entry.layout = null;
    }
    emitBaseUrlEvent(entry, { type: "frame", payload: frame });
  }

  function handleBaseUrlError(entry: BaseUrlTelemetryEntry, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    entry.lastErrorAt = now().toISOString();
    entry.lastErrorMessage = message;
    emitBaseUrlEvent(entry, { type: "error", message });
  }

  function ensureBaseUrlClient(entry: BaseUrlTelemetryEntry) {
    if (entry.client) {
      entry.client.connect();
      return;
    }
    entry.client = new ElectronTelemetryWsClient(
      entry.baseUrl,
      webSocketFactory,
      (layout) => handleBaseUrlLayout(entry, layout),
      (frame) => handleBaseUrlFrame(entry, frame),
      (error) => handleBaseUrlError(entry, error),
      now,
    );
    entry.client.connect();
  }

  async function fetchBaseUrlLayout(
    entry: BaseUrlTelemetryEntry,
    force = false,
  ): Promise<ElectronTelemetryLayoutFrame | null> {
    if (!force && entry.layout) {
      return layoutFrame(entry);
    }
    try {
      const layout = await fetchJson<LayoutModel>(
        fetchImpl,
        buildUrl(entry.baseUrl, "/api/telemetry/workloads_buffer/layout"),
      );
      handleBaseUrlLayout(entry, layout);
      return layoutFrame(entry);
    } catch (error) {
      handleBaseUrlError(entry, error);
      throw error;
    }
  }

  async function postTelemetryJson(
    baseUrl: string,
    pathname: string,
    payload: unknown,
  ): Promise<ElectronTelemetryWriteResult> {
    try {
      const response = await fetchImpl(buildUrl(baseUrl, pathname), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      let body: Record<string, unknown> | null = null;
      try {
        const parsed = await response.json();
        body = parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        body = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        body,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        body: {
          error: error instanceof Error ? error.message : "network_error",
        },
      };
    }
  }

  async function getTelemetryJson(
    baseUrl: string,
    pathname: string,
  ): Promise<ElectronTelemetryPushStatsResult> {
    try {
      const response = await fetchImpl(buildUrl(baseUrl, pathname), {
        cache: "no-store",
      });
      let body: Record<string, unknown> | null = null;
      try {
        const parsed = await response.json();
        body = parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        body = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: "",
        body: {
          error: error instanceof Error ? error.message : "network_error",
        },
      };
    }
  }

  return {
    async listModels() {
      const descriptors = await resolveDescriptors();
      return {
        resource_type: "robotick_studio_telemetry_models",
        project_path: dependencies.getSelectedProjectPath()?.trim() || null,
        models: descriptors.map((descriptor) =>
          toPublicModelInfo(
            descriptor,
            layoutCache.get(descriptor.model_id),
            rawCache.get(descriptor.model_id),
            latestErrors.get(descriptor.model_id) ?? null,
          ),
        ),
      };
    },

    async getLayout(modelId: string) {
      const descriptor = await resolveDescriptor(modelId);
      const layout = await fetchLayout(descriptor);
      return {
        resource_type: "robotick_studio_telemetry_model_layout",
        model: toPublicModelInfo(
          descriptor,
          layout,
          rawCache.get(modelId),
          latestErrors.get(modelId) ?? null,
        ),
        layout: layout.layout,
        loaded_at: layout.loadedAt,
      };
    },

    async getRawBuffer(modelId: string) {
      const descriptor = await resolveDescriptor(modelId);
      const raw = await fetchRaw(descriptor);
      return {
        resource_type: "robotick_studio_telemetry_model_raw_buffer",
        model: toPublicModelInfo(
          descriptor,
          layoutCache.get(modelId),
          raw,
          latestErrors.get(modelId) ?? null,
        ),
        body: raw.body,
        byte_length: raw.body.byteLength,
        frame_seq: raw.frameSeq,
        engine_session_id: raw.engineSessionId,
        loaded_at: raw.loadedAt,
      };
    },

    async getSnapshot(modelId: string) {
      const descriptor = await resolveDescriptor(modelId);
      const [layout, raw] = await Promise.all([
        fetchLayout(descriptor),
        fetchRaw(descriptor),
      ]);
      const decoded = createTelemetryModel(layout.layout);
      decoded.raw = arrayBufferFromBuffer(raw.body);
      return {
        resource_type: "robotick_studio_telemetry_model_snapshot",
        generated_at: now().toISOString(),
        model: toPublicModelInfo(
          descriptor,
          layout,
          raw,
          latestErrors.get(modelId) ?? null,
        ),
        source: {
          frame_seq: raw.frameSeq,
          engine_session_id: raw.engineSessionId ?? layout.layout.engine_session_id ?? null,
          raw_byte_length: raw.body.byteLength,
          layout_loaded_at: layout.loadedAt,
          raw_loaded_at: raw.loadedAt,
        },
        layout: layout.layout,
        engine: serializeStruct(decoded.engine),
        process_threads: decoded.process_threads,
        workloads: decoded.workloads.map(serializeWorkload),
      };
    },

    async ensureLayoutForBaseUrl(baseUrl: string) {
      const trimmed = baseUrl.trim();
      if (!trimmed) {
        return null;
      }
      const entry = getOrCreateBaseUrlEntry(trimmed);
      ensureBaseUrlClient(entry);
      return await fetchBaseUrlLayout(entry, false);
    },

    async refreshLayoutForBaseUrl(baseUrl: string) {
      const trimmed = baseUrl.trim();
      if (!trimmed) {
        return null;
      }
      const entry = getOrCreateBaseUrlEntry(trimmed);
      ensureBaseUrlClient(entry);
      return await fetchBaseUrlLayout(entry, true);
    },

    subscribeBaseUrl(baseUrl: string, listener: ElectronTelemetryStreamListener) {
      const trimmed = baseUrl.trim();
      if (!trimmed) {
        return () => {};
      }
      const entry = getOrCreateBaseUrlEntry(trimmed);
      entry.listeners.add(listener);
      ensureBaseUrlClient(entry);
      const frame = layoutFrame(entry);
      if (frame) {
        listener({ type: "layout", payload: frame });
      }
      if (entry.raw) {
        listener({ type: "frame", payload: entry.raw });
      }
      return () => {
        const current = baseUrlEntries.get(trimmed);
        if (!current) {
          return;
        }
        current.listeners.delete(listener);
        if (current.listeners.size === 0) {
          current.client?.close();
          current.client = null;
          if (!current.layout && !current.raw) {
            baseUrlEntries.delete(trimmed);
          }
        }
      };
    },

    getBaseUrlDiagnostics(baseUrl: string) {
      const entry = baseUrlEntries.get(baseUrl.trim());
      return {
        subscriberCount: entry?.listeners.size ?? 0,
        layoutLoaded: Boolean(entry?.layout),
        lastFrameAt: entry?.raw ? new Date(entry.raw.timestamp).toISOString() : null,
        lastErrorAt: entry?.lastErrorAt ?? null,
        lastErrorMessage: entry?.lastErrorMessage ?? null,
      };
    },

    getSharedDiagnostics() {
      const baseUrls = Array.from(baseUrlEntries.values())
        .sort((left, right) => left.baseUrl.localeCompare(right.baseUrl))
        .map((entry) => ({
          baseUrl: entry.baseUrl,
          subscriberCount: entry.listeners.size,
          layoutLoaded: Boolean(entry.layout),
          rawLoaded: Boolean(entry.raw),
          latestFrameSeq: entry.raw?.frameSeq ?? null,
          latestEngineSessionId: entry.raw?.sid ?? null,
          websocketConnected: entry.client?.readyState === WS_OPEN,
          lastFrameAt: entry.raw ? new Date(entry.raw.timestamp).toISOString() : null,
          lastErrorAt: entry.lastErrorAt,
          lastErrorMessage: entry.lastErrorMessage,
        }));
      return {
        activeBaseUrlCount: baseUrls.length,
        totalSubscriberCount: baseUrls.reduce(
          (total, entry) => total + entry.subscriberCount,
          0,
        ),
        baseUrls,
      };
    },

    async getHealthForBaseUrl(baseUrl) {
      const result = await getTelemetryJson(baseUrl.trim(), "/api/telemetry/health");
      return {
        ok: result.ok,
        status: result.status,
        statusText: result.statusText ?? "",
        body: result.body,
      };
    },

    async getPushStatsForBaseUrl(baseUrl) {
      return await getTelemetryJson(baseUrl.trim(), "/api/telemetry/push_stats");
    },

    async setWorkloadInputFieldsDataForBaseUrl(baseUrl, request) {
      return await postTelemetryJson(
        baseUrl.trim(),
        "/api/telemetry/set_workload_input_fields_data",
        request,
      );
    },

    async setWorkloadInputConnectionStateForBaseUrl(baseUrl, request) {
      return await postTelemetryJson(
        baseUrl.trim(),
        "/api/telemetry/set_workload_input_connection_state",
        request,
      );
    },

    reset() {
      descriptorProjectPath = null;
      descriptorCache = null;
      layoutCache.clear();
      rawCache.clear();
      latestErrors.clear();
      for (const entry of baseUrlEntries.values()) {
        entry.client?.close();
        entry.listeners.clear();
      }
      baseUrlEntries.clear();
    },
  };
}
