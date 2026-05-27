export const DEFAULT_FORWARD_PLAYBACK_RATE = 1;
export const DEFAULT_REVERSE_PLAYBACK_RATE = -1;
export const SHUTTLE_PLAYBACK_RATES = [1, 2, 4] as const;
const PLAYBACK_RATE_EPSILON = 1e-6;

export function normalizePlaybackRate(playbackRate: number | null | undefined): number {
  return typeof playbackRate === "number" && Number.isFinite(playbackRate) ? playbackRate : 0;
}

export function isAnimPlaybackActive(playbackRate: number | null, isRecording = false): boolean {
  return isRecording || Math.abs(normalizePlaybackRate(playbackRate)) > PLAYBACK_RATE_EPSILON;
}

export function playbackDirection(playbackRate: number | null): -1 | 0 | 1 {
  const normalized = normalizePlaybackRate(playbackRate);
  if (normalized > PLAYBACK_RATE_EPSILON) return 1;
  if (normalized < -PLAYBACK_RATE_EPSILON) return -1;
  return 0;
}

export function nextShuttlePlaybackRate(currentPlaybackRate: number | null, direction: -1 | 1): number {
  const normalized = normalizePlaybackRate(currentPlaybackRate);
  const currentDirection = playbackDirection(normalized);
  const currentMagnitude = Math.abs(normalized);
  if (currentDirection !== direction) {
    return direction * SHUTTLE_PLAYBACK_RATES[0];
  }
  for (const speed of SHUTTLE_PLAYBACK_RATES) {
    if (currentMagnitude + PLAYBACK_RATE_EPSILON < speed) {
      return direction * speed;
    }
  }
  return direction * SHUTTLE_PLAYBACK_RATES[SHUTTLE_PLAYBACK_RATES.length - 1];
}
