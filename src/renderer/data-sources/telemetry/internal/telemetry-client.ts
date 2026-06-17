// telemetry-client.ts
// -----------------------------------------------------------------------------
// Renderer telemetry compatibility helpers plus shared decoder re-exports.
// -----------------------------------------------------------------------------

import {
  createTelemetryModel,
  readValue,
  type ITelemetryField,
  type ITelemetryModel,
  type ITelemetryProcessThread,
  type ITelemetryStruct,
  type ITelemetryWorkload,
  type LayoutEnumValue,
  type LayoutField,
  type LayoutModel,
  type LayoutProcessThread,
  type LayoutType,
  type LayoutWritableInput,
  type LayoutWorkload,
  type LayoutWorkloadStruct,
} from "../../../../electron/common/telemetry/telemetry-decoder";

export { createTelemetryModel, readValue };
export type {
  ITelemetryField,
  ITelemetryModel,
  ITelemetryProcessThread,
  ITelemetryStruct,
  ITelemetryWorkload,
  LayoutEnumValue,
  LayoutField,
  LayoutModel,
  LayoutProcessThread,
  LayoutType,
  LayoutWritableInput,
  LayoutWorkload,
  LayoutWorkloadStruct,
};

export interface SetWorkloadInputFieldWrite {
  field_handle?: number;
  field_path?: string;
  value: unknown;
  seq?: number;
}

export interface SetWorkloadInputFieldsDataRequest {
  engine_session_id: string;
  writes: SetWorkloadInputFieldWrite[];
}

export interface SetWorkloadInputFieldsDataResponseBody {
  [key: string]: unknown;
}

export interface SetWorkloadInputFieldsDataResult {
  ok: boolean;
  status: number;
  body: SetWorkloadInputFieldsDataResponseBody | null;
}

export interface SetWorkloadInputFieldsDataOptions {
  maxAttempts?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

export interface SetWorkloadInputConnectionStateUpdate {
  field_handle?: number;
  field_path?: string;
  enabled: boolean;
}

export interface SetWorkloadInputConnectionStateRequest {
  engine_session_id: string;
  updates: SetWorkloadInputConnectionStateUpdate[];
}

export interface SetWorkloadInputConnectionStateResponseBody {
  [key: string]: unknown;
}

export interface SetWorkloadInputConnectionStateResult {
  ok: boolean;
  status: number;
  body: SetWorkloadInputConnectionStateResponseBody | null;
}

export interface SetWorkloadInputConnectionStateOptions {
  maxAttempts?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

type ElectronTelemetryBridge = NonNullable<
  NonNullable<Window["robotick"]>["telemetry"]
>;

function getElectronTelemetryBridge(): ElectronTelemetryBridge {
  const bridge = window.robotick?.telemetry;
  if (!bridge) {
    throw new Error("Electron telemetry bridge is required.");
  }
  return bridge;
}

export async function fetchTelemetryLayout(
  base_url: string,
): Promise<LayoutModel> {
  const payload = await getElectronTelemetryBridge().refreshLayout(base_url);
  if (!payload || typeof payload !== "object") {
    throw new Error("Electron telemetry bridge did not return a layout payload.");
  }
  const layout = (payload as { layout?: unknown }).layout;
  if (!layout || typeof layout !== "object") {
    throw new Error("Electron telemetry bridge returned an invalid layout payload.");
  }
  return layout as LayoutModel;
}

const RETRYABLE_WRITE_STATUS_CODES = new Set([409, 429, 503]);

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeRetryDelayMs(
  attempt: number,
  status: number,
  body: SetWorkloadInputFieldsDataResponseBody | null,
  baseRetryDelayMs: number,
  maxRetryDelayMs: number,
): number {
  const bodyRetryRaw = body?.retry_after_ms;
  const bodyRetry =
    typeof bodyRetryRaw === "number" && Number.isFinite(bodyRetryRaw)
      ? Math.max(0, Math.floor(bodyRetryRaw))
      : null;
  if (status === 429 && bodyRetry !== null) {
    return Math.min(bodyRetry, maxRetryDelayMs);
  }

  const expo = Math.min(maxRetryDelayMs, baseRetryDelayMs * 2 ** (attempt - 1));
  const jitter = Math.floor(expo * (0.2 * Math.random()));
  return Math.min(maxRetryDelayMs, expo + jitter);
}

function normalizeWriteResult(value: unknown): SetWorkloadInputFieldsDataResult {
  if (!value || typeof value !== "object") {
    return { ok: false, status: 0, body: { error: "invalid_write_result" } };
  }
  const candidate = value as {
    ok?: unknown;
    status?: unknown;
    body?: unknown;
  };
  return {
    ok: candidate.ok === true,
    status:
      typeof candidate.status === "number" && Number.isFinite(candidate.status)
        ? candidate.status
        : 0,
    body:
      candidate.body && typeof candidate.body === "object"
        ? (candidate.body as SetWorkloadInputFieldsDataResponseBody)
        : null,
  };
}

export async function setWorkloadInputFieldsData(
  base_url: string,
  request: SetWorkloadInputFieldsDataRequest,
  options: SetWorkloadInputFieldsDataOptions = {},
): Promise<SetWorkloadInputFieldsDataResult> {
  const currentRequest: SetWorkloadInputFieldsDataRequest = {
    engine_session_id: request.engine_session_id,
    writes: request.writes.map((write) => ({ ...write })),
  };
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseRetryDelayMs = Math.max(1, options.baseRetryDelayMs ?? 60);
  const maxRetryDelayMs = Math.max(
    baseRetryDelayMs,
    options.maxRetryDelayMs ?? 500,
  );

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const result = normalizeWriteResult(
      await getElectronTelemetryBridge().setWorkloadInputFieldsData(
        base_url,
        currentRequest,
      ),
    );
    const body = result.body as SetWorkloadInputFieldsDataResponseBody | null;
    if (result.ok) {
      return {
        ok: true,
        status: result.status,
        body,
      };
    }

    const correctedSessionId = body?.engine_session_id;
    if (
      result.status === 412 &&
      typeof correctedSessionId === "string" &&
      correctedSessionId.length > 0 &&
      correctedSessionId !== currentRequest.engine_session_id &&
      attempt < maxAttempts
    ) {
      currentRequest.engine_session_id = correctedSessionId;
      continue;
    }

    if (
      (!RETRYABLE_WRITE_STATUS_CODES.has(result.status) &&
        result.status !== 0) ||
      attempt >= maxAttempts
    ) {
      return { ok: false, status: result.status, body };
    }

    await delay(
      computeRetryDelayMs(
        attempt,
        result.status === 0 ? 503 : result.status,
        body,
        baseRetryDelayMs,
        maxRetryDelayMs,
      ),
    );
  }

  return { ok: false, status: 0, body: { error: "unexpected_retry_exit" } };
}

export async function setWorkloadInputConnectionState(
  base_url: string,
  request: SetWorkloadInputConnectionStateRequest,
  options: SetWorkloadInputConnectionStateOptions = {},
): Promise<SetWorkloadInputConnectionStateResult> {
  const currentRequest: SetWorkloadInputConnectionStateRequest = {
    engine_session_id: request.engine_session_id,
    updates: request.updates.map((update) => ({ ...update })),
  };
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseRetryDelayMs = Math.max(1, options.baseRetryDelayMs ?? 60);
  const maxRetryDelayMs = Math.max(
    baseRetryDelayMs,
    options.maxRetryDelayMs ?? 500,
  );

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const result = normalizeWriteResult(
      await getElectronTelemetryBridge().setWorkloadInputConnectionState(
        base_url,
        currentRequest,
      ),
    );
    const body = result.body as SetWorkloadInputConnectionStateResponseBody | null;

    if (result.ok) {
      return {
        ok: true,
        status: result.status,
        body,
      };
    }

    const correctedSessionId = body?.engine_session_id;
    if (
      result.status === 412 &&
      typeof correctedSessionId === "string" &&
      correctedSessionId.length > 0 &&
      correctedSessionId !== currentRequest.engine_session_id &&
      attempt < maxAttempts
    ) {
      currentRequest.engine_session_id = correctedSessionId;
      continue;
    }

    if (
      (!RETRYABLE_WRITE_STATUS_CODES.has(result.status) &&
        result.status !== 0) ||
      attempt >= maxAttempts
    ) {
      return { ok: false, status: result.status, body };
    }

    await delay(
      computeRetryDelayMs(
        attempt,
        result.status === 0 ? 503 : result.status,
        body,
        baseRetryDelayMs,
        maxRetryDelayMs,
      ),
    );
  }

  return { ok: false, status: 0, body: { error: "unexpected_retry_exit" } };
}
