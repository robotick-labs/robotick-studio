import { describe, expect, it } from "vitest";

import {
  ANIM_PLAYBACK_STATE_PAUSED,
  ANIM_PLAYBACK_STATE_PLAYING,
  ANIM_PLAYBACK_STATE_RECORDING,
  isAnimPlaybackActive,
} from "../../../../../renderer/components/editors/animation-editor/playback-state";

describe("playback-state", () => {
  it("treats only playing and recording as active playback", () => {
    expect(isAnimPlaybackActive(ANIM_PLAYBACK_STATE_PAUSED)).toBe(false);
    expect(isAnimPlaybackActive(ANIM_PLAYBACK_STATE_PLAYING)).toBe(true);
    expect(isAnimPlaybackActive(ANIM_PLAYBACK_STATE_RECORDING)).toBe(true);
    expect(isAnimPlaybackActive(null)).toBe(false);
    expect(isAnimPlaybackActive(99)).toBe(false);
  });
});

