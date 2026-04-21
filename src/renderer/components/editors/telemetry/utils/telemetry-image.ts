import type { ITelemetryField } from "../../../../data-sources/telemetry";

export type TelemetryImagePayload = {
  bytes: Uint8Array;
  mime: string;
};

type CountedByteValue = {
  data_buffer?: unknown;
  count?: unknown;
  metadata?: {
    pixel_format?: unknown;
  };
};

export function isImageMime(mime: string | undefined): boolean {
  return typeof mime === "string" && mime.startsWith("image/");
}

export function isTelemetryImageField(field: ITelemetryField): boolean {
  if (isImageMime(field.mime_type)) {
    return true;
  }
  return isImageStructField(field);
}

export function extractTelemetryImagePayload(
  field: ITelemetryField | null | undefined,
): TelemetryImagePayload | null {
  if (!field) {
    return null;
  }

  const value = field.getValue?.();
  const explicitMime = isImageMime(field.mime_type) ? field.mime_type : undefined;

  if (value instanceof Uint8Array) {
    const mime = explicitMime ?? inferMimeFromBytes(value);
    return mime ? { bytes: value, mime } : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const counted = value as CountedByteValue;
  if (!(counted.data_buffer instanceof Uint8Array)) {
    return null;
  }

  const bytes = trimImageBytes(counted.data_buffer, counted.count);
  if (!bytes) {
    return null;
  }

  const mime =
    explicitMime ??
    imageMimeFromMetadata(counted.metadata) ??
    inferMimeFromBytes(bytes);
  return mime ? { bytes, mime } : null;
}

function isImageStructField(field: ITelemetryField): boolean {
  const fields = field.fields ?? [];
  if (fields.length === 0) {
    return false;
  }

  const hasDataBuffer = fields.some((child) => child.name === "data_buffer");
  const hasCount = fields.some((child) => child.name === "count");
  if (!hasDataBuffer || !hasCount) {
    return false;
  }

  if (fields.some((child) => child.name === "metadata")) {
    return true;
  }

  return fields.some(
    (child) => child.name === "data_buffer" && isImageMime(child.mime_type),
  );
}

function trimImageBytes(raw: Uint8Array, count: unknown): Uint8Array | null {
  if (typeof count !== "number" || !Number.isFinite(count)) {
    return raw.byteLength > 0 ? raw : null;
  }

  const safeCount = Math.max(0, Math.min(raw.byteLength, Math.trunc(count)));
  return safeCount > 0 ? raw.subarray(0, safeCount) : null;
}

function imageMimeFromMetadata(
  metadata: CountedByteValue["metadata"],
): string | null {
  const pixelFormat = metadata?.pixel_format;
  if (pixelFormat === 8 || pixelFormat === "Jpeg") {
    return "image/jpeg";
  }
  if (pixelFormat === 9 || pixelFormat === "Png") {
    return "image/png";
  }
  return null;
}

function inferMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.byteLength >= 8) {
    const isPng =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;
    if (isPng) {
      return "image/png";
    }
  }

  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }

  return null;
}
