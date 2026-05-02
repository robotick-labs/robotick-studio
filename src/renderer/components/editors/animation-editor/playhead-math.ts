export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function normalizedFromClientX(
  clientX: number,
  leftPx: number,
  widthPx: number
): number {
  const safeWidth = Math.max(1, widthPx);
  return clamp01((clientX - leftPx) / safeWidth);
}
