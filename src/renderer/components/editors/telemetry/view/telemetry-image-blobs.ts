// telemetry-image-blobs.ts
// -----------------------------------------------------------------------------
// Centralised, leak-free Blob URL creation with:
//  - Shared caching for all components
//  - Bytewise identity detection (no new URL if unchanged)
//  - Global LRU eviction to prevent infinite growth
// -----------------------------------------------------------------------------
// Robotick Labs 2025
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------
const MAX_LRU_ENTRIES = 64; // Enough for multiple thumbnails + live panels

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
interface BlobCacheEntry {
  url: string;
  mime: string;
  bytes: Uint8Array;
  lastUsed: number; // for LRU
}

// -----------------------------------------------------------------------------
// Global blob cache (map raw signature → URL)
// -----------------------------------------------------------------------------
const blobCache = new Map<string, BlobCacheEntry>();
const hashByBuffer = new WeakMap<
  ArrayBufferLike,
  { hash: string; byteOffset: number; byteLength: number; mime: string }
>();

// Utility: fast signature (hash of contents)
function hashBytes(bytes: Uint8Array): string {
  // FNV-1a 32-bit (fast, good enough)
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function getHashedSignature(bytes: Uint8Array, mime: string): string {
  const cached = hashByBuffer.get(bytes.buffer);
  if (
    cached &&
    cached.byteOffset === bytes.byteOffset &&
    cached.byteLength === bytes.byteLength &&
    cached.mime === mime
  ) {
    return `${mime}:${cached.hash}`;
  }

  const hash = hashBytes(bytes);
  hashByBuffer.set(bytes.buffer, {
    hash,
    byteOffset: bytes.byteOffset,
    byteLength: bytes.byteLength,
    mime,
  });
  return `${mime}:${hash}`;
}

// -----------------------------------------------------------------------------
// LRU eviction
// -----------------------------------------------------------------------------
function enforceLRU() {
  if (blobCache.size <= MAX_LRU_ENTRIES) return;

  const sorted = [...blobCache.entries()].sort(
    (a, b) => a[1].lastUsed - b[1].lastUsed
  );

  const toRemove = sorted.slice(0, blobCache.size - MAX_LRU_ENTRIES);

  for (const [key, entry] of toRemove) {
    URL.revokeObjectURL(entry.url);
    blobCache.delete(key);
  }
}

// -----------------------------------------------------------------------------
// Central function that returns a stable blob URL for given bytes
/**
 * Provide a stable object URL for the given byte content and MIME type, reusing a cached URL when the same bytes and MIME were previously requested.
 *
 * @param raw - The binary data to expose via the object URL
 * @param mime - The MIME type to assign to the created Blob
 * @returns The object URL for the provided data and MIME type; an empty string if `raw` is null or empty
 */
export function getOrCreateBlobURL(raw: Uint8Array, mime: string): string {
  if (!raw || raw.length === 0) return "";

  const signature = getHashedSignature(raw, mime);

  const now = performance.now();

  // Cache hit
  const existing = blobCache.get(signature);
  if (existing) {
    existing.lastUsed = now;
    return existing.url;
  }

  // Create new URL
  const slice = raw.buffer.slice(
    raw.byteOffset,
    raw.byteOffset + raw.byteLength
  ) as ArrayBuffer;
  const blob = new Blob([slice], { type: mime });
  const url = URL.createObjectURL(blob);

  blobCache.set(signature, {
    url,
    mime,
    bytes: raw,
    lastUsed: now,
  });

  // Enforce LRU size
  enforceLRU();

  return url;
}

// -----------------------------------------------------------------------------
// React Hook wrapper — stable URL per raw image
// -----------------------------------------------------------------------------
// Cleans up *only* when component unmounts; global LRU handles eviction.
//
export function useBlobURL(raw: Uint8Array | null, mime: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const localRef = useRef<string | null>(null);

  const signature = useMemo(() => {
    if (!raw || !mime) return null;
    const key = getHashedSignature(raw, mime);
    return {
      key,
      raw,
      mime,
    };
  }, [raw, mime]);

  useEffect(() => {
    if (!signature) {
      setUrl(null);
      return;
    }

    const newUrl = getOrCreateBlobURL(signature.raw, signature.mime);
    setUrl(newUrl);
    localRef.current = newUrl;

    return () => {
      localRef.current = null;
    };
  }, [signature?.key]);

  return url;
}
