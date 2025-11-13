// telemetry-client.ts
// -----------------------------------------------------------------------------
// Robotick unified absolute-offset telemetry decoder
// - Uses layout.types[] as the canonical schema
// - Resolves structs recursively with unlimited depth
// - Computes absolute offsets for every field
// - Propagates type.meta to DecodedStruct and DecodedField
// - Decodes primitives + FixedStringNN
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Raw Layout Types (directly from engine /layout endpoint)
// -----------------------------------------------------------------------------

export interface LayoutField {
  name: string;
  type: string;
  offset_within_container: number;
}

export interface LayoutType {
  name: string;
  size: number;
  alignment?: number;
  type_category?: number;
  meta?: string; // NEW: propagate to decoded
  fields?: LayoutField[];
}

export interface WorkloadStructRef {
  type: string;
  offset_within_container: number;
}

export interface LayoutWorkload {
  name: string;
  type: string;
  offset_within_container: number;

  config?: WorkloadStructRef;
  inputs?: WorkloadStructRef;
  outputs?: WorkloadStructRef;
}

export interface TelemetryLayout {
  workloads: LayoutWorkload[];
  types: LayoutType[];
  engine_session_id?: string;
  buffer_size_used?: number;
}

// -----------------------------------------------------------------------------
// Decoded Structures (for UI / React)
// -----------------------------------------------------------------------------

export interface DecodedField {
  name: string;
  type: string;
  path: string;
  offset: number; // absolute byte offset into raw buffer
  value: any;
  meta?: string; // NEW: inherited from LayoutType.meta
  children?: DecodedField[];
}

export interface DecodedStruct {
  typeName: string;
  offset: number; // absolute byte offset of struct root
  fields: DecodedField[];
  meta?: string; // NEW
}

export interface DecodedWorkload {
  name: string;
  type: string;
  config?: DecodedStruct;
  inputs?: DecodedStruct;
  outputs?: DecodedStruct;
}

export interface DecodedModel {
  workloads: DecodedWorkload[];
}

// -----------------------------------------------------------------------------
// Value decoding
// -----------------------------------------------------------------------------

function readValue(
  view: DataView,
  raw: ArrayBuffer,
  offset: number,
  type: string,
  meta: string
): any {
  try {
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

    // FixedStringNN
    if (meta === "text/plain") {
      const max = parseInt(type.replace(/\D/g, ""), 10) || 0;
      const bytes = new Uint8Array(raw, offset, max);
      const zero = bytes.indexOf(0);
      const slice = bytes.slice(0, zero >= 0 ? zero : max);
      return new TextDecoder().decode(slice);
    }

    if (type) {
      // Return raw blind data buffer when type cannot be interpreted.
      // (Viewer code will detect Uint8Array or ArrayBuffer accordingly.)
      const remaining = new Uint8Array(raw, offset);
      return remaining.slice(); // copy so slices don’t alias the main buffer
    }
  } catch {
    // Fall through to return null below
  }

  return null;
}

// -----------------------------------------------------------------------------
// Main struct decoder
// -----------------------------------------------------------------------------

export function decodeTelemetry(
  layout: TelemetryLayout,
  raw: ArrayBuffer
): DecodedModel {
  const view = new DataView(raw);
  const typeMap = new Map<string, LayoutType>();

  // Build type registry
  for (const t of layout.types) {
    typeMap.set(t.name, t);
  }

  // -------------------------------------------------------------
  // Recursive struct decoder (absolute offsets)
  // -------------------------------------------------------------
  function decodeByType(
    typeName: string,
    baseOffset: number,
    pathPrefix: string
  ): DecodedStruct {
    const t = typeMap.get(typeName);

    const out: DecodedStruct = {
      typeName,
      offset: baseOffset,
      fields: [],
      meta: t?.meta ?? undefined,
    };

    if (!t || !t.fields || t.fields.length === 0) {
      return out;
    }

    for (const f of t.fields) {
      const abs = baseOffset + f.offset_within_container;
      const path = `${pathPrefix}.${f.name}`;
      const childType = typeMap.get(f.type);

      const isComposite =
        childType &&
        Array.isArray(childType.fields) &&
        childType.fields.length > 0;

      // Composite struct → recurse
      if (isComposite) {
        const nested = decodeByType(f.type, abs, path);
        out.fields.push({
          name: f.name,
          type: f.type,
          path,
          offset: abs,
          value: undefined,
          meta: childType?.meta ?? undefined,
          children: nested.fields,
        });
      }
      // Leaf field
      else {
        out.fields.push({
          name: f.name,
          type: f.type,
          path,
          offset: abs,
          value: readValue(view, raw, abs, f.type, childType?.meta ?? ""),
          meta: childType?.meta ?? undefined,
        });
      }
    }

    return out;
  }

  // -------------------------------------------------------------------------
  // Decode each workload and inline config/inputs/outputs completely
  // -------------------------------------------------------------------------

  const decodedWorkloads: DecodedWorkload[] = [];

  for (const wl of layout.workloads) {
    const base = wl.offset_within_container;

    const d: DecodedWorkload = {
      name: wl.name,
      type: wl.type,
    };

    if (wl.config) {
      d.config = decodeByType(
        wl.config.type,
        base + wl.config.offset_within_container,
        `${wl.name}.config`
      );
    }

    if (wl.inputs) {
      d.inputs = decodeByType(
        wl.inputs.type,
        base + wl.inputs.offset_within_container,
        `${wl.name}.inputs`
      );
    }

    if (wl.outputs) {
      d.outputs = decodeByType(
        wl.outputs.type,
        base + wl.outputs.offset_within_container,
        `${wl.name}.outputs`
      );
    }

    decodedWorkloads.push(d);
  }

  return { workloads: decodedWorkloads };
}

// -----------------------------------------------------------------------------
// Convenience API: extract all leaf fields for a workload's outputs
//  - Flattens nested struct fields
//  - Returns [{ path, type, value, offset, meta }, ...]
// -----------------------------------------------------------------------------

export interface WorkloadOutputField {
  path: string;
  type: string;
  value: any;
  offset: number;
  meta?: string;
}

export function getWorkloadOutputFields(
  decodedModel: DecodedModel,
  workloadName: string
): WorkloadOutputField[] {
  const workload = decodedModel.workloads.find((w) => w.name === workloadName);
  if (!workload || !workload.outputs) return [];

  const out: WorkloadOutputField[] = [];

  function recurse(fields: DecodedField[]) {
    for (const f of fields) {
      if (f.children && f.children.length > 0) {
        recurse(f.children);
      } else {
        out.push({
          path: f.path,
          type: f.type,
          value: f.value,
          offset: f.offset,
          meta: f.meta,
        });
      }
    }
  }

  recurse(workload.outputs.fields);
  return out;
}
