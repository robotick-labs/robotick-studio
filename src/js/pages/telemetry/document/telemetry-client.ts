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

export interface LayoutField {
  name: string;
  type: string;
  offset_within_container: number;
  element_count: number;
}

export interface LayoutType {
  name: string;
  size: number;
  alignment?: number;
  type_category?: number;
  mime_type?: string;
  fields?: LayoutField[];
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

export interface LayoutModel {
  workloads: LayoutWorkload[];
  types: LayoutType[];
  engine_session_id: string;
  buffer_size_used: number;
}

// -----------------------------------------------------------------------------
// Decoded Structures (for UI / React)
// -----------------------------------------------------------------------------

export interface ITelemetryField {
  name: string;
  type: string;
  path: string;
  offset: number; // absolute byte offset into raw buffer
  mime_type?: string; // inherited from LayoutType.mime_type
  fields?: ITelemetryField[]; // composite schema (one instance)
  model: ITelemetryModel;

  getValue(): any;
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
  stats?: ITelemetryStruct;
  config?: ITelemetryStruct;
  inputs?: ITelemetryStruct;
  outputs?: ITelemetryStruct;
}

export interface ITelemetryModel {
  workloads: ITelemetryWorkload[];
  raw: ArrayBuffer | null;
  buffer_size_used: number;
  getField?(path: string): ITelemetryField | undefined;
}

// -----------------------------------------------------------------------------
// Core endpoints
// -----------------------------------------------------------------------------

export async function fetchLayout(url: string): Promise<LayoutModel | null> {
  try {
    const r = await fetch(`${url}/api/telemetry/workloads_buffer/layout`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as LayoutModel;
  } catch {
    return null;
  }
}

export async function fetchRaw(
  base_url: string
): Promise<{ raw: ArrayBuffer; sid: string }> {
  const url = `${base_url}/api/telemetry/workloads_buffer/raw`;
  try {
    const r = await fetch(url, {
      cache: "no-store",
    });
    const buf = await r.arrayBuffer();
    const sid = r.headers.get("x-robotick-session-id") || "";
    return { raw: buf, sid };
  } catch (error) {
    console.warn(`fetchRaw() failed for '${url}'`, error);
    return { raw: new ArrayBuffer(0), sid: "" };
  }
}

// -----------------------------------------------------------------------------
// Value decoding (primitives / FixedStringNN)
// -----------------------------------------------------------------------------

function readSingle(
  view: DataView,
  raw: ArrayBuffer,
  offset: number,
  type: string,
  mime_type: string
): any {
  switch (type) {
    case "float":
      return view.getFloat32(offset, true);
    case "double":
      return view.getFloat64(offset, true);
    case "bool":
      return view.getUint8(offset) !== 0;
    case "int":
      return view.getInt32(offset, true);
    case "uint32_t":
      return view.getUint32(offset, true);
    case "uint16_t":
      return view.getUint16(offset, true);
    case "int16_t":
      return view.getInt16(offset, true);
    case "int8_t":
      return view.getInt8(offset);
    case "uint8_t":
      return view.getUint8(offset);
  }

  // FixedStringNN (mime_type marks text)
  if (mime_type === "text/plain") {
    const max = parseInt(type.replace(/\D/g, ""), 10) || 0;
    const bytes = new Uint8Array(raw, offset, max);
    const zero = bytes.indexOf(0);
    const slice = bytes.slice(0, zero >= 0 ? zero : max);
    return new TextDecoder().decode(slice);
  }

  // Unknown / raw → tail copy
  if (type) {
    const remaining = new Uint8Array(raw, offset);
    return remaining.slice();
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
  element_count: number
): any {
  try {
    if (element_count <= 1) {
      return readSingle(view, raw, offset, type, mime_type);
    }
    if (type === "uint8_t") {
      return new Uint8Array(raw, offset, element_count);
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
  // Reader service kept in the factory; FieldImpl calls back into it.
  interface Reader {
    getLeaf(
      model: TelemetryModel,
      abs: number,
      type: string,
      mime_type?: string,
      count?: number
    ): unknown;
    buildObject(
      model: TelemetryModel,
      typeName: string,
      baseOffset: number
    ): Record<string, unknown>;
    buildArray(
      model: TelemetryModel,
      typeName: string,
      baseOffset: number,
      count: number,
      strideBytes: number
    ): Record<string, unknown>[];
  }

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
          return new Uint8Array(raw, abs, count);
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
                childType?.size ?? 0
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
              f.element_count
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

    const buildStruct = (
      typeName: string,
      base: number,
      path: string
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
                true
              )
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
                false
              )
            );
          }
        }
      }

      return new TelemetryStruct(typeName, base, fields, t?.mime_type);
    };

    const workloads: ITelemetryWorkload[] = [];
    for (const wl of layout.workloads) {
      const base = wl.offset_within_container;
      const d: ITelemetryWorkload = { name: wl.name, type: wl.type };

      if (wl.config) {
        d.config = buildStruct(
          wl.config.type,
          base + wl.config.offset_within_container,
          `${wl.name}.config`
        );
      }
      if (wl.inputs) {
        d.inputs = buildStruct(
          wl.inputs.type,
          base + wl.inputs.offset_within_container,
          `${wl.name}.inputs`
        );
      }
      if (wl.outputs) {
        d.outputs = buildStruct(
          wl.outputs.type,
          base + wl.outputs.offset_within_container,
          `${wl.name}.outputs`
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
            `${wl.name}.stats`
          );
        }
      }

      workloads.push(d);
    }

    model.buffer_size_used = layout.buffer_size_used;
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
  buffer_size_used: number = 0;
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
    public readonly mime_type?: string
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
        count?: number
      ) => unknown;
      buildObject: (
        model: TelemetryModel,
        typeName: string,
        base: number
      ) => Record<string, unknown>;
      buildArray: (
        model: TelemetryModel,
        typeName: string,
        base: number,
        count: number,
        stride: number
      ) => Record<string, unknown>[];
    },
    public readonly mime_type?: string,
    private readonly elementCount: number = 1,
    public readonly fields?: ITelemetryField[],
    private readonly childSize: number = 0, // for struct arrays
    private readonly isCompositeNode: boolean = false
  ) {}

  getValue(): any {
    if (this.isCompositeNode) {
      if (this.elementCount > 1) {
        return this.reader.buildArray(
          this.model,
          this.type,
          this.offset,
          this.elementCount,
          this.childSize
        );
      }
      if (this.fields?.length) {
        const obj: Record<string, unknown> = {};
        for (const c of this.fields) obj[c.name] = c.getValue();
        return obj;
      }
      return this.reader.buildObject(this.model, this.type, this.offset);
    }
    return this.reader.getLeaf(
      this.model,
      this.offset,
      this.type,
      this.mime_type,
      this.elementCount
    );
  }
}

// -----------------------------------------------------------------------------
// Public entrypoint (unchanged)
// -----------------------------------------------------------------------------

export function createTelemetryModel(layout: LayoutModel): ITelemetryModel {
  return TelemetryFactory.create(layout);
}
