// telemetry-client.ts
// -----------------------------------------------------------------------------
// Robotick unified absolute-offset telemetry decoder
// - Uses layout.types[] as the canonical schema
// - Resolves structs recursively with unlimited depth
// - Computes absolute offsets for every field
// - Propagates type.mime_type to DecodedStruct and DecodedField
// - Decodes primitives + FixedStringNN
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Raw Layout Types (directly from engine /layout endpoint)
// -----------------------------------------------------------------------------

import { sendTelemetryWriteWs } from "./telemetry-ws-client";

export interface LayoutField {
  name: string;
  type: string;
  offset_within_container: number;
  element_count: number;
}

export interface LayoutEnumValue {
  name: string;
  value: number;
}

export interface LayoutType {
  name: string;
  size: number;
  alignment?: number;
  type_category?: number;
  mime_type?: string;
  fields?: LayoutField[];
  enum_values?: LayoutEnumValue[];
  enum_underlying_size?: number;
  enum_is_signed?: boolean;
  enum_is_flags?: boolean;
}

export interface LayoutWorkloadStruct {
  type: string;
  offset_within_container: number;
}

export interface LayoutWorkload {
  name: string;
  type: string;
  offset_within_container: number;
  stats_offset_within_container: number;

  config?: LayoutWorkloadStruct;
  inputs?: LayoutWorkloadStruct;
  outputs?: LayoutWorkloadStruct;
}

export interface LayoutWritableInput {
  field_handle: number;
  field_path: string;
  type?: string;
  size?: number;
}

export interface LayoutModel {
  workloads: LayoutWorkload[];
  types: LayoutType[];
  engine_session_id?: string;
  workloads_buffer_size_used: number;
  process_memory_used: number;
  writable_inputs?: LayoutWritableInput[];
}

// -----------------------------------------------------------------------------
// Decoded Structures (for UI / React)
// -----------------------------------------------------------------------------

export interface ITelemetryField {
  name: string;
  type: string;
  path: string;
  offset: number; // absolute byte offset into raw buffer
  elementCount: number;
  mime_type?: string; // inherited from LayoutType.mime_type
  enum_values?: LayoutEnumValue[];
  enum_is_flags?: boolean;
  enum_is_signed?: boolean;
  enum_underlying_size?: number;
  writable_input_handle?: number;
  fields?: ITelemetryField[]; // composite schema (one instance)
  model: ITelemetryModel;

  getValue(): any;
  getArrayElement?(index: number): ITelemetryField | null;
}

export interface ITelemetryStruct {
  typeName: string;
  offset: number; // absolute byte offset of struct root
  fields: ITelemetryField[];
  mime_type?: string;
}

export interface ITelemetryWorkload {
  name: string;
  type: string;
  workloadsBufferTotalBytes: number;
  workloadsBufferStaticBytes: number;
  workloadsBufferDynamicBytes: number;
  stats?: ITelemetryStruct;
  config?: ITelemetryStruct;
  inputs?: ITelemetryStruct;
  outputs?: ITelemetryStruct;
}

export interface ITelemetryModel {
  workloads: ITelemetryWorkload[];
  raw: ArrayBuffer | null;
  schemaSessionId: string;
  workloads_buffer_size_used: number;
  process_memory_used: number;
  writable_inputs_by_path?: ReadonlyMap<string, LayoutWritableInput>;
  getField?(path: string): ITelemetryField | undefined;
}

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
    const result = await sendTelemetryWriteWs(base_url, currentRequest);
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
      (!RETRYABLE_WRITE_STATUS_CODES.has(result.status) && result.status !== 0) ||
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

// -----------------------------------------------------------------------------
// Value decoding (primitives / FixedStringNN)
// -----------------------------------------------------------------------------

function withinBounds(total: number, offset: number, bytes: number): boolean {
  if (offset < 0) return false;
  if (bytes <= 0) return offset <= total;
  return offset + bytes <= total;
}

function safeUint8Slice(
  raw: ArrayBuffer,
  offset: number,
  length: number,
): Uint8Array | null {
  if (!withinBounds(raw.byteLength, offset, length)) {
    return null;
  }
  try {
    return new Uint8Array(raw, offset, length);
  } catch {
    return null;
  }
}

function readSingle(
  view: DataView,
  raw: ArrayBuffer,
  offset: number,
  type: string,
  mime_type: string,
): any {
  const safeRead = <T>(bytes: number, reader: () => T): T | null => {
    if (!withinBounds(view.byteLength, offset, bytes)) return null;
    try {
      return reader();
    } catch {
      return null;
    }
  };

  switch (type) {
    case "float":
      return safeRead(4, () => view.getFloat32(offset, true));
    case "double":
      return safeRead(8, () => view.getFloat64(offset, true));
    case "bool":
      return safeRead(1, () => view.getUint8(offset) !== 0);
    case "int":
      return safeRead(4, () => view.getInt32(offset, true));
    case "uint32_t":
      return safeRead(4, () => view.getUint32(offset, true));
    case "uint16_t":
      return safeRead(2, () => view.getUint16(offset, true));
    case "int16_t":
      return safeRead(2, () => view.getInt16(offset, true));
    case "int8_t":
      return safeRead(1, () => view.getInt8(offset));
    case "uint8_t":
      return safeRead(1, () => view.getUint8(offset));
  }

  if (mime_type === "text/plain") {
    const max = parseInt(type.replace(/\D/g, ""), 10) || 0;
    if (max <= 0) return "";
    const available = Math.min(max, Math.max(0, raw.byteLength - offset));
    if (!withinBounds(raw.byteLength, offset, available)) return "";
    try {
      const bytes = new Uint8Array(raw, offset, available);
      const zero = bytes.indexOf(0);
      const slice = bytes.slice(0, zero >= 0 ? zero : available);
      return new TextDecoder().decode(slice);
    } catch {
      return "";
    }
  }

  if (type) {
    if (offset < 0 || offset > raw.byteLength) return null;
    try {
      const remaining = new Uint8Array(raw, offset);
      return remaining.slice();
    } catch {
      return null;
    }
  }

  return null;
}

function bytesPerPrimitive(type: string, mime_type: string): number {
  switch (type) {
    case "float":
      return 4;
    case "double":
      return 8;
    case "bool":
      return 1;
    case "int":
      return 4;
    case "uint32_t":
      return 4;
    case "uint16_t":
      return 2;
    case "int16_t":
      return 2;
    case "int8_t":
      return 1;
    case "uint8_t":
      return 1;
  }
  if (mime_type === "text/plain") {
    return parseInt(type.replace(/\D/g, ""), 10) || 0; // FixedStringN
  }
  return 1;
}

export function readValue(
  view: DataView,
  raw: ArrayBuffer,
  offset: number,
  type: string,
  mime_type: string,
  element_count: number,
): any {
  try {
    if (element_count <= 1) {
      return readSingle(view, raw, offset, type, mime_type);
    }
    if (type === "uint8_t") {
      return safeUint8Slice(raw, offset, element_count);
    }
    const results: any[] = [];
    let localOffset = offset;
    const stride = bytesPerPrimitive(type, mime_type);
    for (let i = 0; i < element_count; i++) {
      results.push(readSingle(view, raw, localOffset, type, mime_type));
      localOffset += stride;
    }
    return results;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Factory (Apple Tree): ALL construction + composite reading lives here
// -----------------------------------------------------------------------------

namespace TelemetryFactory {
  interface ByteRange {
    start: number;
    end: number;
  }

  // Reader service kept in the factory; FieldImpl calls back into it.
  interface Reader {
    getLeaf(
      model: TelemetryModel,
      abs: number,
      type: string,
      mime_type?: string,
      count?: number,
    ): unknown;
    buildObject(
      model: TelemetryModel,
      typeName: string,
      baseOffset: number,
    ): Record<string, unknown>;
    buildArray(
      model: TelemetryModel,
      typeName: string,
      baseOffset: number,
      count: number,
      strideBytes: number,
    ): Record<string, unknown>[];
  }

  function pushRange(
    ranges: ByteRange[],
    start: number,
    size: number,
    clipStart = Number.NEGATIVE_INFINITY,
    clipEnd = Number.POSITIVE_INFINITY,
  ) {
    if (!Number.isFinite(start) || !Number.isFinite(size) || size <= 0) {
      return;
    }

    const clippedStart = Math.max(start, clipStart);
    const clippedEnd = Math.min(start + size, clipEnd);
    if (!Number.isFinite(clippedStart) || !Number.isFinite(clippedEnd)) {
      return;
    }
    if (clippedEnd <= clippedStart) {
      return;
    }

    ranges.push({ start: clippedStart, end: clippedEnd });
  }

  function measureUnion(ranges: ByteRange[]): number {
    if (ranges.length === 0) {
      return 0;
    }

    const ordered = [...ranges].sort((a, b) => a.start - b.start);
    let total = 0;
    let currentStart = ordered[0]!.start;
    let currentEnd = ordered[0]!.end;

    for (let i = 1; i < ordered.length; i++) {
      const range = ordered[i]!;
      if (range.start <= currentEnd) {
        currentEnd = Math.max(currentEnd, range.end);
        continue;
      }

      total += currentEnd - currentStart;
      currentStart = range.start;
      currentEnd = range.end;
    }

    total += currentEnd - currentStart;
    return total;
  }

  function collectDynamicRanges(
    typeMap: ReadonlyMap<string, LayoutType>,
    typeName: string,
    baseOffset: number,
    inlineContainerStart: number,
    inlineContainerEnd: number,
    outRanges: ByteRange[],
    visited: Set<string>,
  ) {
    const visitKey = `${typeName}@${baseOffset}`;
    if (visited.has(visitKey)) {
      return;
    }
    visited.add(visitKey);

    const type = typeMap.get(typeName);
    if (!type?.fields?.length) {
      return;
    }

    for (const field of type.fields) {
      const fieldType = typeMap.get(field.type);
      if (!fieldType) {
        continue;
      }

      const elementCount = Math.max(1, field.element_count ?? 1);
      const elementStride = Math.max(0, fieldType.size ?? 0);
      const fieldBase = baseOffset + field.offset_within_container;
      const totalFieldSize = elementStride * elementCount;

      if (totalFieldSize > 0) {
        pushRange(
          outRanges,
          fieldBase,
          totalFieldSize,
          Number.NEGATIVE_INFINITY,
          inlineContainerStart,
        );
        pushRange(
          outRanges,
          fieldBase,
          totalFieldSize,
          inlineContainerEnd,
          Number.POSITIVE_INFINITY,
        );
      }

      if (!fieldType.fields?.length || elementStride <= 0) {
        continue;
      }

      for (let index = 0; index < elementCount; index++) {
        const childBase = fieldBase + index * elementStride;
        collectDynamicRanges(
          typeMap,
          field.type,
          childBase,
          childBase,
          childBase + elementStride,
          outRanges,
          visited,
        );
      }
    }
  }

  function computeWorkloadMemoryBytes(
    workload: LayoutWorkload,
    typeMap: ReadonlyMap<string, LayoutType>,
  ): {
    totalBytes: number;
    staticBytes: number;
    dynamicBytes: number;
  } {
    const statsTypeSize = Math.max(
      0,
      typeMap.get("WorkloadInstanceStats")?.size ?? 0,
    );

    const staticRanges: ByteRange[] = [];
    const dynamicRanges: ByteRange[] = [];
    const roots = [
      {
        struct: workload.config,
        base: workload.offset_within_container,
      },
      {
        struct: workload.inputs,
        base: workload.offset_within_container,
      },
      {
        struct: workload.outputs,
        base: workload.offset_within_container,
      },
    ];
    for (const root of roots) {
      if (!root.struct) {
        continue;
      }

      const rootTypeSize = Math.max(0, typeMap.get(root.struct.type)?.size ?? 0);
      if (rootTypeSize <= 0) {
        continue;
      }

      const rootBase = root.base + root.struct.offset_within_container;
      pushRange(staticRanges, rootBase, rootTypeSize);

      collectDynamicRanges(
        typeMap,
        root.struct.type,
        rootBase,
        rootBase,
        rootBase + rootTypeSize,
        dynamicRanges,
        new Set<string>(),
      );
    }

    if (statsTypeSize > 0) {
      pushRange(staticRanges, workload.stats_offset_within_container, statsTypeSize);
    }

    const staticBytes = measureUnion(staticRanges);
    const dynamicBytes = measureUnion(dynamicRanges);
    return {
      totalBytes: staticBytes + dynamicBytes,
      staticBytes,
      dynamicBytes,
    };
  }

  /**
   * Build an ITelemetryModel from a LayoutModel, wiring type metadata, workloads, and decoding helpers.
   *
   * @param layout - The layout describing types, workloads, and offsets used to construct the telemetry model
   * @returns An ITelemetryModel configured from `layout`, with workloads, type map, and a path lookup; the model's raw buffer is unset until assigned so callers must set `model.raw` before reading values
   */
  export function create(layout: LayoutModel): ITelemetryModel {
    const typeMap = new Map<string, LayoutType>();
    for (const t of layout.types) typeMap.set(t.name, t);

    const reader: Reader = {
      getLeaf(model, abs, type, mime_type, count = 1) {
        const view = model.view();
        const raw = model.raw;
        if (!view || !raw) return null;
        if (count <= 1)
          return readSingle(view, raw, abs, type, mime_type ?? "");

        const hasMeta =
          typeof mime_type === "string" && mime_type.trim().length > 0;
        if (type === "uint8_t" || (hasMeta && mime_type !== "text/plain")) {
          return safeUint8Slice(raw, abs, count ?? 0);
        }
        return readValue(view, raw, abs, type, mime_type ?? "", count);
      },

      buildObject(model, typeName, base) {
        const t = typeMap.get(typeName);
        const out: Record<string, unknown> = {};
        if (!t?.fields?.length) return out;

        for (const f of t.fields) {
          const childAbs = base + f.offset_within_container;
          const childType = typeMap.get(f.type);
          const isComposite = !!(
            childType?.fields && childType.fields.length > 0
          );

          if (isComposite) {
            if ((f.element_count ?? 1) > 1) {
              out[f.name] = reader.buildArray(
                model,
                f.type,
                childAbs,
                f.element_count,
                childType?.size ?? 0,
              );
            } else {
              out[f.name] = reader.buildObject(model, f.type, childAbs);
            }
          } else {
            out[f.name] = reader.getLeaf(
              model,
              childAbs,
              f.type,
              childType?.mime_type,
              f.element_count,
            );
          }
        }
        return out;
      },

      buildArray(model, typeName, base, count, strideBytes) {
        const arr: Record<string, unknown>[] = [];
        if (count <= 0) return arr;
        const stride = Math.max(0, strideBytes);
        for (let i = 0; i < count; i++) {
          const elemBase = stride ? base + i * stride : base;
          arr.push(reader.buildObject(model, typeName, elemBase));
          if (!stride) break; // missing size fallback
        }
        return arr;
      },
    };

    const model = new TelemetryModel(typeMap);
    model.schemaSessionId = layout.engine_session_id ?? "";
    const writableInputsByPath = new Map<string, LayoutWritableInput>();
    for (const writable of layout.writable_inputs ?? []) {
      if (
        writable &&
        typeof writable.field_path === "string" &&
        Number.isFinite(writable.field_handle)
      ) {
        writableInputsByPath.set(writable.field_path, writable);
      }
    }
    model.writable_inputs_by_path = writableInputsByPath;

    const buildStruct = (
      typeName: string,
      base: number,
      path: string,
    ): TelemetryStruct => {
      const t = typeMap.get(typeName);
      const fields: ITelemetryField[] = [];

      if (t?.fields?.length) {
        for (const f of t.fields) {
          const abs = base + f.offset_within_container;
          const childType = typeMap.get(f.type);
          const isComposite = !!(
            childType?.fields && childType.fields.length > 0
          );
          const childPath = `${path}.${f.name}`;
          const writableMeta = writableInputsByPath.get(childPath);

          if (isComposite) {
            // Schema for one instance, array handled at getValue()
            const nested = buildStruct(f.type, abs, childPath);
            fields.push(
              new TelemetryField(
                f.name,
                f.type,
                childPath,
                abs,
                model,
                reader,
                childType?.mime_type,
                f.element_count,
                nested.fields,
                childType?.size ?? 0,
                true,
                childType?.enum_values,
                childType?.enum_is_flags,
                childType?.enum_is_signed,
                childType?.enum_underlying_size,
                writableMeta?.field_handle,
              ),
            );
          } else {
            fields.push(
              new TelemetryField(
                f.name,
                f.type,
                childPath,
                abs,
                model,
                reader,
                childType?.mime_type,
                f.element_count,
                undefined,
                0,
                false,
                childType?.enum_values,
                childType?.enum_is_flags,
                childType?.enum_is_signed,
                childType?.enum_underlying_size,
                writableMeta?.field_handle,
              ),
            );
          }
        }
      }

      return new TelemetryStruct(typeName, base, fields, t?.mime_type);
    };

    const workloads: ITelemetryWorkload[] = [];
    for (const wl of layout.workloads) {
      const base = wl.offset_within_container;
      const memoryBytes = computeWorkloadMemoryBytes(wl, typeMap);
      const d: ITelemetryWorkload = {
        name: wl.name,
        type: wl.type,
        workloadsBufferTotalBytes: memoryBytes.totalBytes,
        workloadsBufferStaticBytes: memoryBytes.staticBytes,
        workloadsBufferDynamicBytes: memoryBytes.dynamicBytes,
      };

      if (wl.config) {
        d.config = buildStruct(
          wl.config.type,
          base + wl.config.offset_within_container,
          `${wl.name}.config`,
        );
      }
      if (wl.inputs) {
        d.inputs = buildStruct(
          wl.inputs.type,
          base + wl.inputs.offset_within_container,
          `${wl.name}.inputs`,
        );
      }
      if (wl.outputs) {
        d.outputs = buildStruct(
          wl.outputs.type,
          base + wl.outputs.offset_within_container,
          `${wl.name}.outputs`,
        );
      }

      // Stats
      {
        const statsType = typeMap.get("WorkloadInstanceStats");
        if (statsType && typeof wl.stats_offset_within_container === "number") {
          const abs = wl.stats_offset_within_container; // relative to raw-buffer not workload

          d.stats = buildStruct(
            "WorkloadInstanceStats",
            abs,
            `${wl.name}.stats`,
          );
        }
      }

      workloads.push(d);
    }

    model.workloads_buffer_size_used = layout.workloads_buffer_size_used;
    model.process_memory_used = layout.process_memory_used;
    model.workloads = workloads;

    // Path lookup identical to previous behaviour
    model.getField = (path: string): ITelemetryField | undefined => {
      const parts = path.split(".");
      if (parts.length < 3) return undefined;

      const [workloadName, section] = parts;
      const wl = model.workloads.find((w) => w.name === workloadName);
      if (!wl) return;

      const root =
        section === "config"
          ? wl.config
          : section === "inputs"
            ? wl.inputs
            : section === "outputs"
              ? wl.outputs
              : undefined;
      if (!root) return;

      let fields = root.fields as ReadonlyArray<ITelemetryField>;
      for (let i = 2; i < parts.length; i++) {
        const next = fields.find((f) => f.name === parts[i]);
        if (!next) return;
        if (i === parts.length - 1) return next;
        if (!next.fields) return;
        fields = next.fields;
      }
      return undefined;
    };

    return model;
  }
}

// -----------------------------------------------------------------------------
// Lean Impl classes (no construction logic)
// -----------------------------------------------------------------------------

class TelemetryModel implements ITelemetryModel {
  workloads: ITelemetryWorkload[] = [];
  schemaSessionId: string = "";
  workloads_buffer_size_used: number = 0;
  process_memory_used: number = 0;
  writable_inputs_by_path: ReadonlyMap<string, LayoutWritableInput> = new Map();
  private _raw: ArrayBuffer | null = null;
  private _view: DataView | null = null;

  constructor(public readonly typeMap: ReadonlyMap<string, LayoutType>) {}

  get raw(): ArrayBuffer | null {
    return this._raw;
  }
  set raw(buf: ArrayBuffer | null) {
    this._raw = buf;
    this._view = buf ? new DataView(buf) : null;
  }

  getField?: ITelemetryModel["getField"];

  view(): DataView | null {
    return this._view;
  }
}

class TelemetryStruct implements ITelemetryStruct {
  constructor(
    public readonly typeName: string,
    public readonly offset: number,
    public readonly fields: ITelemetryField[],
    public readonly mime_type?: string,
  ) {}
}

class TelemetryField implements ITelemetryField {
  constructor(
    public readonly name: string,
    public readonly type: string,
    public readonly path: string,
    public readonly offset: number,
    public readonly model: TelemetryModel,
    private readonly reader: {
      getLeaf: (
        model: TelemetryModel,
        abs: number,
        type: string,
        mime_type?: string,
        count?: number,
      ) => unknown;
      buildObject: (
        model: TelemetryModel,
        typeName: string,
        base: number,
      ) => Record<string, unknown>;
      buildArray: (
        model: TelemetryModel,
        typeName: string,
        base: number,
        count: number,
        stride: number,
      ) => Record<string, unknown>[];
    },
    public readonly mime_type?: string,
    public readonly elementCount: number = 1,
    public readonly fields?: ITelemetryField[],
    private readonly childSize: number = 0, // for struct arrays
    private readonly isCompositeNode: boolean = false,
    public readonly enum_values?: LayoutEnumValue[],
    public readonly enum_is_flags?: boolean,
    public readonly enum_is_signed?: boolean,
    public readonly enum_underlying_size?: number,
    public readonly writable_input_handle?: number,
  ) {}

  getValue(): any {
    if (this.isCompositeNode) {
      if (this.elementCount > 1) {
        return this.reader.buildArray(
          this.model,
          this.type,
          this.offset,
          this.elementCount,
          this.childSize,
        );
      }
      if (this.fields?.length) {
        const obj: Record<string, unknown> = {};
        for (const c of this.fields) obj[c.name] = c.getValue();
        return obj;
      }
      return this.reader.buildObject(this.model, this.type, this.offset);
    }
    const enumValue = this.readEnumValues();
    if (enumValue !== null) {
      return enumValue;
    }
    return this.reader.getLeaf(
      this.model,
      this.offset,
      this.type,
      this.mime_type,
      this.elementCount,
    );
  }

  getArrayElement(index: number): ITelemetryField | null {
    if (this.elementCount <= 1) return null;
    if (index < 0 || index >= this.elementCount) return null;

    const stride = this.isCompositeNode
      ? this.childSize
      : this.getPrimitiveStrideBytes();
    if (stride <= 0) return null;

    const elementOffset = this.offset + index * stride;
    const elementPath = `${this.path}[${index}]`;

    return this.cloneForElement(
      `[${index}]`,
      elementPath,
      elementOffset,
      1,
      this.fields,
    );
  }

  private readEnumValues(): number | bigint | Array<number | bigint> | null {
    if (!this.enum_values || this.enum_values.length === 0) return null;
    if (!this.enum_underlying_size) return null;
    const view = this.model.view();
    const raw = this.model.raw;
    if (!view || !raw) return null;

    const size = this.enum_underlying_size;
    const safeMax = BigInt(Number.MAX_SAFE_INTEGER);
    const safeMin = BigInt(Number.MIN_SAFE_INTEGER);
    const toJsValue = (value: bigint | number): number | bigint => {
      if (typeof value === "number") return value;
      if (value <= safeMax && value >= safeMin) {
        return Number(value);
      }
      return value;
    };

    const readSingle = (offset: number): number | bigint | null => {
      if (!withinBounds(view.byteLength, offset, size)) return null;
      switch (size) {
        case 1:
          return this.enum_is_signed
            ? view.getInt8(offset)
            : view.getUint8(offset);
        case 2:
          return this.enum_is_signed
            ? view.getInt16(offset, true)
            : view.getUint16(offset, true);
        case 4:
          return this.enum_is_signed
            ? view.getInt32(offset, true)
            : view.getUint32(offset, true);
        case 8: {
          const low = BigInt(view.getUint32(offset, true));
          const high = BigInt(view.getUint32(offset + 4, true));
          let combined = (high << 32n) | low;
          const isSigned = Boolean(this.enum_is_signed);
          if (
            isSigned &&
            (view.getUint32(offset + 4, true) & 0x80000000) !== 0
          ) {
            combined -= 1n << 64n;
          }
          return toJsValue(combined);
        }
        default:
          return null;
      }
    };

    if (this.elementCount <= 1) {
      return readSingle(this.offset);
    }

    const results: Array<number | bigint> = [];
    let currentOffset = this.offset;
    for (let i = 0; i < this.elementCount; i++) {
      const val = readSingle(currentOffset);
      if (val === null) break;
      results.push(val);
      currentOffset += size;
    }
    return results;
  }

  private cloneForElement(
    name: string,
    path: string,
    offset: number,
    elementCount: number,
    sourceFields?: ITelemetryField[],
  ): ITelemetryField {
    const clonedFields = sourceFields?.map((child) =>
      this.cloneChildField(child, path, offset),
    );

    return new TelemetryField(
      name,
      this.type,
      path,
      offset,
      this.model,
      this.reader,
      this.mime_type,
      elementCount,
      clonedFields,
      this.childSize,
      this.isCompositeNode,
      this.enum_values,
      this.enum_is_flags,
      this.enum_is_signed,
      this.enum_underlying_size,
      this.writable_input_handle,
    );
  }

  private cloneChildField(
    child: ITelemetryField,
    parentPath: string,
    parentOffset: number,
  ): ITelemetryField {
    const childOffsetDelta = child.offset - this.offset;
    const clonedChildPath = `${parentPath}.${child.name}`;
    const childFields = child.fields?.map((grandChild) =>
      this.cloneNestedField(
        grandChild,
        child.path,
        child.offset,
        clonedChildPath,
        parentOffset + childOffsetDelta,
      ),
    );

    return new TelemetryField(
      child.name,
      child.type,
      clonedChildPath,
      parentOffset + childOffsetDelta,
      this.model,
      this.reader,
      child.mime_type,
      child.elementCount,
      childFields,
      this.getChildSize(child),
      this.isCompositeField(child),
      child.enum_values,
      child.enum_is_flags,
      child.enum_is_signed,
      child.enum_underlying_size,
      child.writable_input_handle,
    );
  }

  private cloneNestedField(
    field: ITelemetryField,
    sourceBasePath: string,
    sourceBaseOffset: number,
    targetBasePath: string,
    targetBaseOffset: number,
  ): ITelemetryField {
    const relativePath = field.path.startsWith(`${sourceBasePath}.`)
      ? field.path.slice(sourceBasePath.length + 1)
      : field.name;
    const clonedPath = `${targetBasePath}.${relativePath}`;
    const offsetDelta = field.offset - sourceBaseOffset;
    const clonedOffset = targetBaseOffset + offsetDelta;
    const clonedFields = field.fields?.map((child) =>
      this.cloneNestedField(
        child,
        field.path,
        field.offset,
        clonedPath,
        clonedOffset,
      ),
    );

    return new TelemetryField(
      field.name,
      field.type,
      clonedPath,
      clonedOffset,
      this.model,
      this.reader,
      field.mime_type,
      field.elementCount,
      clonedFields,
      this.getChildSize(field),
      this.isCompositeField(field),
      field.enum_values,
      field.enum_is_flags,
      field.enum_is_signed,
      field.enum_underlying_size,
      field.writable_input_handle,
    );
  }

  private getChildSize(field: ITelemetryField): number {
    const childType = this.model.typeMap.get(field.type);
    return childType?.size ?? 0;
  }

  private isCompositeField(field: ITelemetryField): boolean {
    return Boolean(field.fields && field.fields.length > 0);
  }

  private getPrimitiveStrideBytes(): number {
    if (this.enum_underlying_size && this.enum_underlying_size > 0) {
      return this.enum_underlying_size;
    }
    const typeInfo = this.model.typeMap.get(this.type);
    return Math.max(0, typeInfo?.size ?? 0);
  }
}

// -----------------------------------------------------------------------------
// Public entrypoint (unchanged)
// -----------------------------------------------------------------------------

export function createTelemetryModel(layout: LayoutModel): ITelemetryModel {
  return TelemetryFactory.create(layout);
}
