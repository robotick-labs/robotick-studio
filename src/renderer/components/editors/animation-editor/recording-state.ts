export function channelMaskFromSelection(channelNames: string[], selectedByChannel: Record<string, boolean>): number {
  let mask = 0;
  const count = Math.min(channelNames.length, 32);
  for (let index = 0; index < count; index += 1) {
    if (selectedByChannel[channelNames[index]] === true) {
      mask |= 1 << index;
    }
  }
  return mask >>> 0;
}

export function channelSelectionFromMask(channelNames: string[], maskValue: unknown): Record<string, boolean> {
  const mask = typeof maskValue === "number" && Number.isFinite(maskValue) ? Math.max(0, Math.trunc(maskValue)) >>> 0 : 0;
  const next: Record<string, boolean> = {};
  for (let index = 0; index < channelNames.length; index += 1) {
    next[channelNames[index]] = index < 32 && (mask & (1 << index)) !== 0;
  }
  return next;
}
