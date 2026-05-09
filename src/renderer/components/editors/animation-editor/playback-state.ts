export const ANIM_PLAYBACK_STATE_PAUSED = 0;
export const ANIM_PLAYBACK_STATE_PLAYING = 1;
export const ANIM_PLAYBACK_STATE_RECORDING = 2;

export function isAnimPlaybackActive(playbackState: number | null): boolean {
  return playbackState === ANIM_PLAYBACK_STATE_PLAYING || playbackState === ANIM_PLAYBACK_STATE_RECORDING;
}

