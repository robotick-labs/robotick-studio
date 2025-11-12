// telemetry-client.ts
// -----------------------------------------------------------------------------
// Lightweight client for fetching and decoding Robotick telemetry buffers
// -----------------------------------------------------------------------------

export interface TelemetryField {
  name: string;
  type: string;
  offset_within_container: number;
  size?: number;
}

export interface TelemetryType {
  name: string;
  size?: number;
  meta?: string;
  fields?: TelemetryField[];
}

export interface TelemetryWorkload {
  name: string;
  offset_within_container: number;
  config?: TelemetryField[];
  inputs?: TelemetryField[];
  outputs?: TelemetryField[];
}

export interface TelemetryLayout {
  types: TelemetryType[];
  workloads: TelemetryWorkload[];
}

export interface DecodedField {
  type: string;
  path: string;
  value: any;
}

export interface DecodedWorkload {
  type?: string;
  config?: Record<string, DecodedField>;
  inputs?: Record<string, DecodedField>;
  outputs?: Record<string, DecodedField>;
}

// -----------------------------------------------------------------------------
// Fetch functions
// -----------------------------------------------------------------------------

export async function fetchLayout(baseUrl: string): Promise<TelemetryLayout> {
  const resp = await fetch(`${baseUrl}/api/telemetry/workloads_buffer/layout`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch layout: ${resp.statusText}`);
  }
  return await resp.json();
}

export async function fetchRawBuffer(
  baseUrl: string
): Promise<{ buffer: ArrayBuffer; sessionId: string | null }> {
  try {
    const resp = await fetch(`${baseUrl}/api/telemetry/workloads_buffer/raw`, {
      cache: "no-store",
      keepalive: true,
    });

    if (resp.ok) {
      const buffer = await resp.arrayBuffer();
      const sessionId = resp.headers.get("X-Robotick-Session-Id");
      return { buffer, sessionId };
    }
  } catch {
    // swallow network or abort errors
  }

  // fallback: empty result
  return { buffer: new ArrayBuffer(0), sessionId: null };
}

// -----------------------------------------------------------------------------
// Decoder
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Decoder
// -----------------------------------------------------------------------------

export function decodeTelemetry(
  layout: TelemetryLayout,
  arrayBuffer: ArrayBuffer
): Record<string, DecodedWorkload> {
  const view = new DataView(arrayBuffer);
  const typeMap = Object.fromEntries(layout.types.map((t) => [t.name, t]));

  function safe<T>(fn: () => T): T | string {
    try {
      return fn();
    } catch {
      return "<out-of-bounds>";
    }
  }

  function decodeText(offset: number, length: number): string {
    const bytes = new Uint8Array(view.buffer, offset, length);
    const nullIndex = bytes.indexOf(0);
    const end = nullIndex >= 0 ? nullIndex : bytes.length;
    return new TextDecoder().decode(bytes.slice(0, end));
  }

  // Decode any primitive or text value
  function decodePrimitive(typeName: string, absoluteOffset: number): any {
    switch (typeName) {
      case "float":
        return safe(() => view.getFloat32(absoluteOffset, true));
      case "double":
        return safe(() => view.getFloat64(absoluteOffset, true));
      case "bool":
        return safe(() => !!view.getUint8(absoluteOffset));
      case "int":
        return safe(() => view.getInt32(absoluteOffset, true));
      case "uint16_t":
        return safe(() => view.getUint16(absoluteOffset, true));
      case "uint32_t":
        return safe(() => view.getUint32(absoluteOffset, true));
    }

    const typeDesc = typeMap[typeName];
    if (typeDesc?.meta === "text/plain" && typeDesc.size) {
      return safe(() => decodeText(absoluteOffset, typeDesc.size!));
    }

    // Blind-data fallback: return raw bytes if size is known
    if (typeDesc?.size) {
      return safe(
        () =>
          new Uint8Array(
            view.buffer,
            absoluteOffset,
            Math.min(typeDesc.size!, view.byteLength - absoluteOffset)
          )
      );
    }

    // No descriptor or unknown size
    return safe(
      () => new Uint8Array(view.buffer, absoluteOffset, 16) // arbitrary 16-byte peek
    );
  }

  // Recursively decode struct fields into nested JS objects
  function decodeStruct(typeName: string, baseOffset: number): any {
    const typeDesc = typeMap[typeName];
    if (!typeDesc) {
      return "<unknown-type>";
    }

    // Primitive or text type — return direct value
    const isPrimitive =
      !typeDesc.fields || typeDesc.fields.length === 0 || !!typeDesc.meta;
    if (isPrimitive) {
      return decodePrimitive(typeName, baseOffset);
    }

    // Composite: recursively decode subfields
    const result: Record<string, any> = {};
    for (const field of typeDesc.fields) {
      const absOffset = baseOffset + field.offset_within_container;
      result[field.name] = decodeStruct(field.type, absOffset);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Decode workloads into nested objects
  // ---------------------------------------------------------------------------

  const workloads: Record<string, DecodedWorkload> = {};

  for (const workload of layout.workloads) {
    const decoded_workload: DecodedWorkload = {};
    const base = workload.offset_within_container;

    decoded_workload.type = (workload as any)["type"];

    for (const section_name of ["config", "inputs", "outputs"]) {
      const section = (workload as any)[section_name];
      if (!section) continue;

      if (
        typeof section.type === "string" &&
        typeof section.offset_within_container === "number"
      ) {
        const absOffset = base + section.offset_within_container;
        const decodedStruct = decodeStruct(section.type, absOffset);
        (decoded_workload as any)[section_name] = decodedStruct;
      }
    }

    workloads[workload.name] = decoded_workload;
  }

  return workloads;
}

// -----------------------------------------------------------------------------
// Workload outputs accessor
// -----------------------------------------------------------------------------

/**
 * Fetches layout + raw buffer, decodes them, and returns a simple
 * { path: value } map for all output leaf fields of a named workload.
 */
export async function getWorkloadOutputFields(
  baseUrl: string,
  workloadName: string
): Promise<DecodedWorkload | null> {
  try {
    const [layout, raw] = await Promise.all([
      fetchLayout(baseUrl),
      fetchRawBuffer(baseUrl),
    ]);

    if (!raw.buffer || raw.buffer.byteLength === 0) {
      return null;
    }

    const decoded = decodeTelemetry(layout, raw.buffer);
    const workload = decoded[workloadName];
    if (workload && typeof workload === "object") {
      return workload;
    }

    return null;
  } catch (err) {
    return null;
  }
}
